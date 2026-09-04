// LinkedIn provider.
//
// Unlike X, there is no public API that returns a post from an ID, so the content
// script scrapes the rendered post and hands the result here. This module's job is to
// turn that scraped payload into the same normalised shape `lib/fxtwitter.js` returns,
// so `background.js` and the Discord wire format stay provider-agnostic.
//
// Verified against the legacy post-page markup (`.feed-shared-update-v2`) on
// 2026-09-04. The logged-in feed uses a different renderer with hashed class names and
// no post URN in the DOM, which is why only post pages are supported.

const TAG = "[XEmissary:linkedin]";

// LinkedIn activity IDs are snowflake-like: the high bits are a millisecond timestamp.
// Verified: urn:li:activity:7501028718866509824 >> 22n === 2026-09-02T21:30:08.952Z,
// which matched the post's own "1d" label.
const SNOWFLAKE_SHIFT = 22n;

export function postedIsoFromUrn(urn) {
  try {
    const id = BigInt(String(urn).split(":").pop());
    const ms = Number(id >> SNOWFLAKE_SHIFT);
    // Sanity-check: reject anything outside a plausible range rather than emit a
    // nonsense date. LinkedIn launched well after 2000.
    if (ms < 946684800000 || ms > Date.now() + 86400000) return null;
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

// Maps the content script's scraped payload onto the shared post shape.
// `videoCandidates` and `posterUrl` are LinkedIn-only extras consumed by resolveVideo().
export function normalisePost(scraped) {
  const displayName = scraped.displayName || "Unknown";
  return {
    displayName,
    screenName: scraped.screenName || "",
    avatarUrl: scraped.avatarUrl || null,
    text: scraped.text || "",
    postedIso: scraped.postedIso || postedIsoFromUrn(scraped.urn),
    photos: (scraped.photos || []).filter(Boolean),
    videos: [], // filled in by the background once a downloadable variant is resolved
    url: scraped.url || "",
    lang: scraped.lang || "",
    posterUrl: scraped.posterUrl || null,
    videoCandidates: scraped.videoCandidates || [],
  };
}

// Note: licdn URLs are signed per-path. Rewriting the size segment to request a larger
// avatar (e.g. _100_100 -> _200_200) invalidates the signature and 404s — verified
// against a live post. Always pass media URLs through exactly as scraped.

// Attempts to produce a downloadable video Blob from the URLs the page was observed
// fetching. Runs in the background service worker, where host permissions exempt it
// from CORS — the page itself cannot fetch these cross-origin.
//
// Ordered cheapest-first; returns null when nothing works, and the caller falls back to
// the poster image plus a link to the post.
export async function resolveVideo(candidates, capBytes, debug = false) {
  const dlog = (...a) => { if (debug) console.warn(TAG, ...a); };
  const urls = (candidates || []).filter(Boolean);
  if (!urls.length) return null;

  // 1. Whole MP4 files, read from the page's own data payload. Candidates arrive best
  //    quality first, so the first that fits under the cap wins.
  const progressive = urls.filter((u) => /\.mp4(?:[?#]|$)/i.test(u) || /\/mp4-\d+p/i.test(u));
  for (const url of progressive) {
    const blob = await fetchWithin(url, capBytes, dlog);
    if (blob) { dlog("resolved via progressive mp4,", blob.size, "bytes"); return blob; }
  }
  if (progressive.length) dlog(progressive.length, "progressive candidates, none fit under cap");

  // 2. A DASH manifest listing a single-file representation.
  const dash = urls.find((u) => /\/playlist\/vid\/dash\//i.test(u) || /\.mpd(?:[?#]|$)/i.test(u));
  if (dash) {
    const fromDash = await tryDash(dash, capBytes, dlog);
    if (fromDash) { dlog("resolved via dash BaseURL"); return fromDash; }
  }

  // 3. An HLS playlist whose fragments can be concatenated back into one file.
  //    Match only a real .m3u8 — LinkedIn's numbered segment URLs also contain "/hls-",
  //    and feeding one of those to the playlist parser just wastes a request.
  const hls = urls.find((u) => /\.m3u8(?:[?#]|$)/i.test(u));
  if (hls) {
    const fromHls = await tryHls(hls, capBytes, dlog);
    if (fromHls) { dlog("resolved via hls concatenation"); return fromHls; }
  }

  dlog("no downloadable video variant found among", urls.length, "candidates");
  return null;
}

async function fetchWithin(url, capBytes, dlog) {
  try {
    const res = await fetch(url);
    if (!res.ok) { dlog("fetch", res.status, "for", strip(url)); return null; }
    const blob = await res.blob();
    if (blob.size > capBytes) { dlog("over cap:", blob.size, ">", capBytes); return null; }
    return blob;
  } catch (e) {
    dlog("fetch failed", strip(url), e.message || e);
    return null;
  }
}

// Reassembles a playable file from a DASH manifest.
//
// LinkedIn's manifests use <SegmentList> with absolute, individually signed segment
// URLs — no <BaseURL>, no <SegmentTemplate> — and each Representation is muxed
// (codecs="avc1…,mp4a…"), so one rendition's init segment followed by its media
// segments concatenates straight into a valid fragmented MP4:
//
//   ftyp moov | styp sidx moof mdat | styp sidx moof mdat | …
//
// Verified against a live post: the result is a well-formed fMP4 that Discord accepts.
// Parsing is by regex because service workers have no DOMParser.
async function tryDash(manifestUrl, capBytes, dlog) {
  try {
    const res = await fetch(manifestUrl);
    if (!res.ok) { dlog("dash manifest HTTP", res.status); return null; }
    const xml = await res.text();

    // Older/other manifests may still point at a single whole file.
    for (const base of [...xml.matchAll(/<BaseURL>([^<]+)<\/BaseURL>/g)].map((m) => m[1].trim()).reverse()) {
      const blob = await fetchWithin(new URL(base, manifestUrl).toString(), capBytes, dlog);
      if (blob) return blob;
    }

    const durationSec = parseDuration(xml);
    // Only muxed renditions are usable: separate video-only and audio-only adaptation
    // sets would need real remuxing to combine, which is out of scope here.
    const reps = parseRepresentations(xml).filter((r) => r.muxed);
    if (!reps.length) { dlog("no muxed representation in manifest"); return null; }
    reps.sort((a, b) => b.bandwidth - a.bandwidth);

    for (const rep of reps) {
      // Skip renditions that cannot fit before spending the bandwidth on them.
      if (durationSec && rep.bandwidth) {
        const estimate = (rep.bandwidth / 8) * durationSec;
        if (estimate > capBytes) {
          dlog(`skipping ${rep.height}p — ~${Math.round(estimate / 1048576)}MB exceeds cap`);
          continue;
        }
      }
      const blob = await fetchParts(rep.urls, capBytes, dlog);
      if (blob) {
        dlog(`assembled ${rep.width}x${rep.height} from ${rep.urls.length} parts, ${blob.size} bytes`);
        return blob;
      }
    }
    return null;
  } catch (e) {
    dlog("dash parse failed", e.message || e);
    return null;
  }
}

// mediaPresentationDuration="PT1H2M12.637S" -> seconds
function parseDuration(xml) {
  const m = xml.match(/mediaPresentationDuration="PT(?:(\d+)H)?(?:(\d+)M)?([\d.]+)S"/);
  if (!m) return 0;
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + parseFloat(m[3] || 0);
}

function parseRepresentations(xml) {
  const reps = [];
  for (const chunk of xml.split(/<Representation\b/).slice(1)) {
    const end = chunk.indexOf("</Representation>");
    const block = end === -1 ? chunk : chunk.slice(0, end);
    // Read attributes from the opening tag only, so child elements can't shadow them.
    const openTag = block.slice(0, block.indexOf(">") + 1);
    const attr = (name) => {
      const m = openTag.match(new RegExp(`\\b${name}="([^"]*)"`));
      return m ? m[1] : "";
    };
    const init = (block.match(/<Initialization\b[^>]*sourceURL="([^"]+)"/) || [])[1];
    const segments = [...block.matchAll(/<SegmentURL\b[^>]*media="([^"]+)"/g)].map((m) => m[1]);
    if (!init || !segments.length) continue;
    const codecs = attr("codecs");
    reps.push({
      bandwidth: parseInt(attr("bandwidth"), 10) || 0,
      width: parseInt(attr("width"), 10) || 0,
      height: parseInt(attr("height"), 10) || 0,
      codecs,
      muxed: codecs.includes(","),
      urls: [init, ...segments],
    });
  }
  return reps;
}

// Fetches an ordered list of segment URLs and joins them into one Blob, stopping as
// soon as the running total would exceed the cap.
async function fetchParts(urls, capBytes, dlog) {
  const chunks = [];
  let total = 0;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) { dlog("segment HTTP", res.status); return null; }
      const buf = await res.arrayBuffer();
      total += buf.byteLength;
      if (total > capBytes) { dlog("segments exceed cap at", total); return null; }
      chunks.push(buf);
    } catch (e) {
      dlog("segment fetch failed", e.message || e);
      return null;
    }
  }
  return new Blob(chunks, { type: "video/mp4" });
}

// Concatenating an fMP4 init segment with its media segments yields a playable file.
// Bails out on MPEG-TS segments, which would need real remuxing to be useful.
async function tryHls(playlistUrl, capBytes, dlog) {
  try {
    const res = await fetch(playlistUrl);
    if (!res.ok) return null;
    const text = await res.text();
    if (!/^#EXTM3U/m.test(text)) { dlog("not an m3u8"); return null; }

    // A master playlist points at variant playlists; follow the first variant.
    if (/#EXT-X-STREAM-INF/.test(text)) {
      const variant = text.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#"));
      if (!variant) return null;
      return tryHls(new URL(variant.trim(), playlistUrl).toString(), capBytes, dlog);
    }

    const lines = text.split(/\r?\n/);
    const parts = [];
    const mapMatch = text.match(/#EXT-X-MAP:URI="([^"]+)"/);
    if (mapMatch) parts.push(new URL(mapMatch[1], playlistUrl).toString());
    for (const line of lines) {
      const t = line.trim();
      if (t && !t.startsWith("#")) parts.push(new URL(t, playlistUrl).toString());
    }
    if (!parts.length) return null;
    if (parts.some((p) => /\.ts(?:[?#]|$)/i.test(p))) {
      dlog("MPEG-TS segments need remuxing — not supported");
      return null;
    }

    return fetchParts(parts, capBytes, dlog);
  } catch (e) {
    dlog("hls assembly failed", e.message || e);
    return null;
  }
}

// Signed licdn URLs carry long token query strings; keep them out of logs.
function strip(url) {
  return String(url).split("?")[0];
}
