// Registration of the LinkedIn content script.
//
// LinkedIn is an optional host permission, so its content script is registered at
// runtime rather than declared in the manifest. That keeps a default install limited to
// X. The catch is that dynamic registrations are dropped when the extension is reloaded
// or updated, while the setting and the granted permission both survive — leaving the
// options page reporting LinkedIn as "on" while nothing is actually injected.
//
// syncLinkedInScript() reconciles the two and is called on install and on startup, so
// the registration cannot silently drift away from the setting.

export const LINKEDIN_ORIGINS = ["https://www.linkedin.com/*", "https://*.licdn.com/*"];
export const LINKEDIN_SCRIPT_ID = "linkedin";

const SCRIPT = {
  id: LINKEDIN_SCRIPT_ID,
  matches: ["https://www.linkedin.com/*"],
  js: ["content/content.js"],
  css: ["content/content.css"],
  runAt: "document_idle",
  persistAcrossSessions: true,
};

export async function isLinkedInRegistered() {
  try {
    const found = await chrome.scripting.getRegisteredContentScripts({ ids: [LINKEDIN_SCRIPT_ID] });
    return Array.isArray(found) && found.length > 0;
  } catch {
    return false;
  }
}

export async function hasLinkedInPermission() {
  try {
    return await chrome.permissions.contains({ origins: LINKEDIN_ORIGINS });
  } catch {
    return false;
  }
}

export async function registerLinkedInScript() {
  if (await isLinkedInRegistered()) return;
  await chrome.scripting.registerContentScripts([SCRIPT]);
}

export async function unregisterLinkedInScript() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [LINKEDIN_SCRIPT_ID] });
  } catch {
    // Already absent.
  }
}

// Makes the registration match the setting. Safe to call repeatedly.
export async function syncLinkedInScript(enabled) {
  const shouldRun = !!enabled && (await hasLinkedInPermission());
  const running = await isLinkedInRegistered();
  if (shouldRun && !running) {
    await registerLinkedInScript();
    return "registered";
  }
  if (!shouldRun && running) {
    await unregisterLinkedInScript();
    return "unregistered";
  }
  return "unchanged";
}
