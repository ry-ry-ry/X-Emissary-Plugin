import { getWebhooks, getSettings } from "../lib/storage.js";
import { getTweet } from "../lib/fxtwitter.js";
import { extractDate } from "../lib/dateParser.js";
import { shrinkImage } from "../lib/mediaShrink.js";
import { postToWebhook, truncateContent, MAX_ATTACHMENTS } from "../lib/discord.js";
import { translateText, languageName } from "../lib/translate.js";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "getWebhooks") {
        sendResponse({ ok: true, webhooks: await getWebhooks() });
      } else if (msg.type === "getPreview") {
        sendResponse({ ok: true, preview: await buildPreview(msg.tweetId) });
      } else if (msg.type === "openOptions") {
        chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
      } else if (msg.type === "send") {
        sendResponse(await sendTweet(msg.tweetId, msg.webhookId, !!msg.translate));
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

async function buildPreview(tweetId) {
  const settings = await getSettings();
  const tweet = await getTweet(tweetId, settings.debug);
  const date = extractDate(tweet.text, tweet.postedIso, settings.dateFormat);
  return {
    displayName: tweet.displayName,
    snippet: tweet.text.slice(0, 140),
    dateLabel: date.label,
    dateSource: date.source,
    photoCount: tweet.photos.length,
    videoCount: tweet.videos.length,
    url: tweet.url,
    lang: tweet.lang || "",
  };
}

async function sendTweet(tweetId, webhookId, translate = false) {
  const [webhooks, settings] = await Promise.all([getWebhooks(), getSettings()]);
  const webhook = webhooks.find((w) => w.id === webhookId);
  if (!webhook) return { ok: false, error: "Webhook not found" };

  const capBytes = Math.max(1, Math.floor(settings.sizeCapMb * 1024 * 1024));

  const tweet = await getTweet(tweetId, settings.debug);
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

  const header = `**${tweet.displayName}** — ${date.label}${date.source === "posted" ? " (posted)" : ""}`;
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
  const fixedTail = link + videoSuffix;
  const content = truncateContent(header + tweetBody, fixedTail);

  const result = await postToWebhook({
    webhookUrl: webhook.url,
    content,
    embeds,
    files,
  });

  if (!result.ok) {
    return { ok: false, error: `Discord ${result.status}: ${result.body || "(no body)"}` };
  }
  return { ok: true };
}

async function testWebhook(webhookUrl) {
  const result = await postToWebhook({
    webhookUrl,
    content: "Defense Emissary connection test ✓",
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
