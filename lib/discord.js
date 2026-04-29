export async function postToWebhook({ webhookUrl, content, embeds = [], files = [] }) {
  const form = new FormData();
  const payload = { content: content || "" };
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

export function truncateContent(text, suffix = "") {
  const limit = DISCORD_CONTENT_LIMIT - suffix.length;
  if (text.length <= limit) return text + suffix;
  return text.slice(0, Math.max(0, limit - 1)) + "…" + suffix;
}
