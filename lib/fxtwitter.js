const ENDPOINTS = [
  (id) => `https://api.fxtwitter.com/i/status/${encodeURIComponent(id)}`,
  (id) => `https://api.fxtwitter.com/status/${encodeURIComponent(id)}`,
  (id) => `https://api.fxtwitter.com/2/status/${encodeURIComponent(id)}`,
];

const TAG = "[DefenseEmissary:fxtwitter]";

export async function getTweet(id) {
  const errors = [];
  for (const build of ENDPOINTS) {
    const url = build(id);
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const text = await res.text();
      // console.log(TAG, "tried", url, "status", res.status, "bytes", text.length);
      if (!res.ok) {
        errors.push(`${url} → HTTP ${res.status}`);
        continue;
      }
      let json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        errors.push(`${url} → invalid JSON`);
        continue;
      }
      const tweet = extractTweetNode(json);
      if (!tweet) {
        const keys = json && typeof json === "object" ? Object.keys(json).join(",") : "(non-object)";
        console.warn(TAG, "no tweet in response from", url, "top-level keys:", keys, "preview:", text.slice(0, 400));
        errors.push(`${url} → no tweet node (keys: ${keys})`);
        continue;
      }
      return mapTweet(tweet, id);
    } catch (e) {
      errors.push(`${url} → ${e.message || e}`);
      console.warn(TAG, "fetch error", url, e);
    }
  }
  throw new Error("fxtwitter: all endpoints failed — " + errors.join("; "));
}

function extractTweetNode(json) {
  if (!json || typeof json !== "object") return null;
  // Standard FxTwitter v1: { code, message, tweet: {...} }
  if (json.tweet && typeof json.tweet === "object") return json.tweet;
  // Some variants: { data: { tweet: {...} } } or { data: {...tweet fields...} }
  if (json.data && typeof json.data === "object") {
    if (json.data.tweet && typeof json.data.tweet === "object") return json.data.tweet;
    if (json.data.text || json.data.author) return json.data;
  }
  // Or the top level is the tweet itself.
  if (json.text && (json.author || json.user)) return json;
  return null;
}

function mapTweet(t, id) {
  const author = t.author || t.user || {};
  const displayName = author.name || author.display_name || author.screen_name || "Unknown";
  const screenName = author.screen_name || author.username || "";

  const text = t.text || t.full_text || "";

  let postedIso = null;
  if (typeof t.created_timestamp === "number") postedIso = new Date(t.created_timestamp * 1000).toISOString();
  else if (typeof t.created_at === "string") {
    const d = new Date(t.created_at);
    if (!isNaN(d.getTime())) postedIso = d.toISOString();
  }

  const media = t.media || {};
  const photoSrc = media.photos || media.images || media.all || [];
  const photos = photoSrc
    .filter((p) => p && (p.type ? /photo|image|gif/i.test(p.type) : true))
    .map((p) => p.url || p.media_url_https || p.media_url || p.src)
    .filter(Boolean);

  const videoSrc = media.videos || [];
  const videos = videoSrc.map((v) => normaliseVideo(v)).filter((v) => v.formats.length > 0 || v.fallbackUrl);

  const url = t.url || `https://x.com/i/status/${id}`;

  return { displayName, screenName, text, postedIso, photos, videos, url };
}

function normaliseVideo(v) {
  const list = (v.formats || v.variants || []).filter(Boolean);
  const formats = list
    .filter((f) => f && f.url && (f.container ? f.container === "mp4" : /\.mp4(?:[?#]|$)/i.test(f.url) || (f.content_type || "").includes("mp4")))
    .map((f) => ({
      url: f.url,
      bitrate: f.bitrate || 0,
      width: f.width || 0,
      height: f.height || 0,
    }))
    .sort((a, b) => b.bitrate - a.bitrate);
  return {
    formats,
    duration: v.duration || 0,
    thumbnail: v.thumbnail_url || null,
    fallbackUrl: v.url || null,
  };
}
