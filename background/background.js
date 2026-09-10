import { getWebhooks, getSettings } from "../lib/storage.js";
import { getTweet } from "../lib/fxtwitter.js";
import { extractDate } from "../lib/dateParser.js";
import { shrinkImage } from "../lib/mediaShrink.js";
import { postToWebhook, truncateContent, sanitizeUsername, MAX_ATTACHMENTS } from "../lib/discord.js";
import { translateText, languageName } from "../lib/translate.js";
import { normalisePost as normaliseLinkedIn, resolveVideo } from "../lib/providers/linkedin.js";
import { syncLinkedInScript } from "../lib/linkedinScript.js";

// Reloading or updating the extension drops dynamically registered content scripts,
// while the setting and host permission survive — which would leave LinkedIn support
// switched on in options but injecting nothing. Re-assert it whenever we start up.
async function restoreLinkedInScript() {
  try {
    const settings = await getSettings();
    const result = await syncLinkedInScript(settings.linkedinEnabled);
    if (settings.debug) console.warn("[XEmissary] linkedin content script:", result);
  } catch (e) {
    console.warn("[XEmissary] could not restore linkedin content script:", e && e.message ? e.message : e);
  }
}

chrome.runtime.onInstalled.addListener(restoreLinkedInScript);
chrome.runtime.onStartup.addListener(restoreLinkedInScript);

// Rendered as Discord subtext at the end of every message this extension sends.
const EXT_VERSION = chrome.runtime.getManifest().version;
const FOOTER = `\n-# sent by x-emissary-plugin v${EXT_VERSION}`;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "getWebhooks") {
        sendResponse({ ok: true, webhooks: await getWebhooks() });
      } else if (msg.type === "getPreview") {
        sendResponse({ ok: true, preview: await buildPreview(msg.ref) });
      } else if (msg.type === "openOptions") {
        chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
      } else if (msg.type === "send") {
        sendResponse(await sendPost(msg.ref, msg.webhookId, !!msg.translate, sender, !!msg.closeTab));
      } else if (msg.type === "testWebhook") {
        sendResponse(await testWebhook(msg.webhookUrl));
      } else {
        sendResponse({ ok: false, error: "unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  })();
  return true;
});

// Resolves a picker reference into the shared post shape, whichever site it came from.
// X posts are fetched by ID; LinkedIn posts arrive already scraped from the page,
// because LinkedIn has no API that serves a post from an ID.
async function resolvePost(ref, settings) {
  if (ref && ref.provider === "linkedin") return normaliseLinkedIn(ref.post || {});
  return getTweet(ref.tweetId, settings.debug);
}

async function buildPreview(ref) {
  const settings = await getSettings();
  const tweet = await resolvePost(ref, settings);
  const date = extractDate(tweet.text, tweet.postedIso, settings.dateFormat);
  return {
    displayName: tweet.displayName,
    snippet: tweet.text.slice(0, 140),
    dateLabel: date.label,
    dateSource: date.source,
    photoCount: tweet.photos.length,
    videoCount: tweet.videos.length || (tweet.videoCandidates && tweet.videoCandidates.length ? 1 : 0),
    url: tweet.url,
    lang: tweet.lang || "",
  };
}

async function sendPost(ref, webhookId, translate = false, sender = null, closeTab = false) {
  const [webhooks, settings] = await Promise.all([getWebhooks(), getSettings()]);
  const webhook = webhooks.find((w) => w.id === webhookId);
  if (!webhook) return { ok: false, error: "Webhook not found" };

  const capBytes = Math.max(1, Math.floor(settings.sizeCapMb * 1024 * 1024));

  const tweet = await resolvePost(ref, settings);
  const date = extractDate(tweet.text, tweet.postedIso, settings.dateFormat);

  // Auto-translate: replace the tweet text with its English translation, noting the
  // detected source language. Skipped when the post is already English or empty.
  let bodyText = tweet.text;
  let translationNote = "";
  if (translate && tweet.text.trim() && tweet.lang !== "en") {
    try {
      const { text: translated, sourceLang } = await translateText(tweet.text, "en", settings.debug);
      if (translated && translated.trim() && translated.trim() !== tweet.text.trim()) {
        bodyText = translated;
        translationNote = `\n*— translated from ${languageName(sourceLang || tweet.lang)}*`;
      }
    } catch (e) {
      // Non-fatal: fall back to the original text with a small note.
      translationNote = `\n*— translation unavailable (${e.message || e})*`;
    }
  }

  // The message is posted under the author's own name and avatar, so repeating the
  // display name here would just be duplication — lead with the handle instead.
  const byline = tweet.screenName ? `@${tweet.screenName}` : tweet.displayName;
  const header = `**${byline}** — ${date.label}${date.source === "posted" ? " (posted)" : ""}`;
  const tweetBody = bodyText ? `\n\n${bodyText}${translationNote}` : "";
  const link = `\n\n<${tweet.url}>`;

  const linkOnlyVideos = [];
  const files = [];
  const embeds = [];

  // Images: download, shrink if necessary, attach. Cap at MAX_ATTACHMENTS combined.
  const photos = tweet.photos.slice(0, MAX_ATTACHMENTS);
  for (let i = 0; i < photos.length; i++) {
    const url = photos[i];
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      let blob = await res.blob();
      if (blob.size > capBytes) blob = await shrinkImage(blob, capBytes);
      if (blob.size <= capBytes) {
        files.push({ filename: `image-${i + 1}${extFromBlob(blob, url)}`, blob });
      } else {
        embeds.push({ url: url, image: { url } });
      }
    } catch {
      embeds.push({ url, image: { url } });
    }
  }

  // LinkedIn video: the player streams from a blob: URL, so there is no single file to
  // grab. resolveVideo() tries to reassemble one from the URLs the page fetched; when
  // that fails we attach the poster frame so the message still shows what the video is,
  // and fall back to linking the post.
  if (tweet.videoCandidates && tweet.videoCandidates.length) {
    let attached = false;
    if (files.length < MAX_ATTACHMENTS) {
      const blob = await resolveVideo(tweet.videoCandidates, capBytes, settings.debug);
      if (blob) {
        files.push({ filename: "video-1.mp4", blob });
        attached = true;
      }
    }
    if (!attached) {
      if (tweet.posterUrl && files.length < MAX_ATTACHMENTS) {
        try {
          const res = await fetch(tweet.posterUrl);
          if (res.ok) {
            const blob = await res.blob();
            if (blob.size <= capBytes) files.push({ filename: "video-thumbnail.jpg", blob });
          }
        } catch {
          // The thumbnail is a nicety; the link below is the real fallback.
        }
      }
      linkOnlyVideos.push(tweet.url);
    }
  }

  // Videos: walk MP4 formats by descending bitrate, attach the first that fits.
  for (let v = 0; v < tweet.videos.length; v++) {
    if (files.length >= MAX_ATTACHMENTS) {
      linkOnlyVideos.push(tweet.url);
      break;
    }
    const video = tweet.videos[v];
    // FxTwitter's v1 media entries expose only a single top-level `url`; the per-bitrate
    // `formats` list is not always present (notably for GIFs), so fall back to it.
    const candidates = video.formats.map((f) => f.url);
    if (video.fallbackUrl && !candidates.includes(video.fallbackUrl)) candidates.push(video.fallbackUrl);
    let attached = false;
    for (const src of candidates) {
      try {
        const res = await fetch(src);
        if (!res.ok) continue;
        const blob = await res.blob();
        if (blob.size <= capBytes) {
          files.push({ filename: `video-${v + 1}.mp4`, blob });
          attached = true;
          break;
        }
      } catch {
        // try next bitrate
      }
    }
    if (!attached) linkOnlyVideos.push(tweet.url);
  }

  // Build content with truncation. Always preserve the link at the end.
  const videoSuffix = linkOnlyVideos.length
    ? `\n📹 ${[...new Set(linkOnlyVideos)].join(" ")}`
    : "";
  const fixedTail = link + videoSuffix + FOOTER;
  const content = truncateContent(header + tweetBody, fixedTail);

  const result = await postToWebhook({
    webhookUrl: webhook.url,
    content,
    embeds,
    files,
    username: sanitizeUsername(tweet.displayName, tweet.screenName),
    avatarUrl: tweet.avatarUrl,
  });

  if (!result.ok) {
    return { ok: false, error: `Discord ${result.status}: ${result.body || "(no body)"}` };
  }

  // Closes only when the sender ticked the box in the picker, never from a stored
  // setting alone — otherwise sharing from a tab you were reading would close it.
  // Delayed so the picker can show "Sent ✓" first.
  if (closeTab && sender && sender.tab && sender.tab.id != null) {
    const tabId = sender.tab.id;
    setTimeout(() => {
      try {
        chrome.tabs.remove(tabId);
      } catch {
        // Tab already gone — nothing to do.
      }
    }, 1000);
  }
  return { ok: true };
}

async function testWebhook(webhookUrl) {
  const result = await postToWebhook({
    webhookUrl,
    content: `X Emissary connection test ✓${FOOTER}`,
  });
  if (!result.ok) return { ok: false, error: `Discord ${result.status}: ${result.body || "(no body)"}` };
  return { ok: true };
}

function extFromBlob(blob, url) {
  const t = (blob.type || "").toLowerCase();
  if (t.includes("png")) return ".png";
  if (t.includes("jpeg") || t.includes("jpg")) return ".jpg";
  if (t.includes("gif")) return ".gif";
  if (t.includes("webp")) return ".webp";
  const m = (url || "").match(/\.([a-z0-9]{3,4})(?:[?#]|$)/i);
  return m ? "." + m[1].toLowerCase() : ".jpg";
}
