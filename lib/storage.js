const DEFAULT_SETTINGS = { dateFormat: "long", sizeCapMb: 10 };

export async function getWebhooks() {
  const { webhooks = [] } = await chrome.storage.sync.get("webhooks");
  return webhooks;
}

export async function setWebhooks(webhooks) {
  await chrome.storage.sync.set({ webhooks });
}

export async function getSettings() {
  const { settings = {} } = await chrome.storage.sync.get("settings");
  return { ...DEFAULT_SETTINGS, ...settings };
}

export async function setSettings(settings) {
  const merged = { ...(await getSettings()), ...settings };
  await chrome.storage.sync.set({ settings: merged });
  return merged;
}

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
