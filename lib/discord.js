export async function postToWebhook({ webhookUrl, content, embeds = [], files = [], username, avatarUrl }) {
  const form = new FormData();
  const payload = { content: content || "" };
  if (username) payload.username = username;
  if (avatarUrl) payload.avatar_url = avatarUrl;
  if (embeds.length) payload.embeds = embeds;
  if (files.length) payload.attachments = files.map((f, i) => ({ id: i, filename: f.filename }));
  form.append("payload_json", JSON.stringify(payload));
  files.forEach((f, i) => form.append(`files[${i}]`, f.blob, f.filename));

  const res = await fetch(webhookUrl, { method: "POST", body: form });
  const body = await safeText(res);
  return { ok: res.ok, status: res.status, body };
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export const DISCORD_CONTENT_LIMIT = 2000;
export const MAX_ATTACHMENTS = 10;
export const USERNAME_LIMIT = 80;

// Discord rejects a webhook username containing "discord" or "clyde" with a 400, so
// strip them rather than let an otherwise valid post fail to send. Falls back when
// stripping leaves nothing; an empty result means "use the webhook's own name".
const BLOCKED_USERNAME_WORDS = /discord|clyde/gi;

export function sanitizeUsername(name, fallback = "") {
  const clean = (str) => (str || "").replace(BLOCKED_USERNAME_WORDS, "").replace(/\s+/g, " ").trim();
  return (clean(name) || clean(fallback)).slice(0, USERNAME_LIMIT);
}

export function truncateContent(text, suffix = "") {
  const limit = DISCORD_CONTENT_LIMIT - suffix.length;
  if (text.length <= limit) return text + suffix;
  return text.slice(0, Math.max(0, limit - 1)) + "…" + suffix;
}
