import { getWebhooks, setWebhooks, getSettings, setSettings, newId } from "../lib/storage.js";

const list = document.getElementById("webhook-list");
const tmpl = document.getElementById("webhook-row-template");

const addForm = document.getElementById("add-form");
const addName = document.getElementById("add-name");
const addUrl = document.getElementById("add-url");

const settingsForm = document.getElementById("settings-form");
const dateFormat = document.getElementById("date-format");
const sizeCap = document.getElementById("size-cap");
const debug = document.getElementById("debug");
const settingsStatus = document.getElementById("settings-status");

const linkedinEnabled = document.getElementById("linkedin-enabled");
const closeAfterSend = document.getElementById("close-after-send");
const sitesStatus = document.getElementById("sites-status");

const LINKEDIN_ORIGINS = ["https://www.linkedin.com/*", "https://*.licdn.com/*"];
const LINKEDIN_SCRIPT_ID = "linkedin";

// LinkedIn is an optional host permission, so the content script is registered at
// runtime rather than declared in the manifest. That keeps the default install limited
// to X, which matters both for trust and for store review.
linkedinEnabled.addEventListener("change", async () => {
  if (linkedinEnabled.checked) {
    // chrome.permissions.request() MUST be the first call in this handler. Awaiting
    // anything beforehand — even chrome.tabs.getCurrent() — spends the user gesture,
    // and Chrome then rejects the request outright.
    let granted = false;
    let failure = "";
    try {
      granted = await chrome.permissions.request({ origins: LINKEDIN_ORIGINS });
    } catch (e) {
      failure = e && e.message ? e.message : String(e);
    }
    if (!granted) {
      linkedinEnabled.checked = false;
      // A toolbar popup closes when Chrome raises the prompt, cancelling the request,
      // so retry from the full options page where it can stay open.
      if (await inPopup()) {
        showStatus(sitesStatus, "Chrome can't show a permission prompt in this popup — opening the options page", "pending");
        chrome.runtime.openOptionsPage();
      } else {
        showStatus(sitesStatus, `LinkedIn access was not granted${failure ? `: ${failure}` : ""}`, "err");
      }
      return;
    }
    await registerLinkedInScript();
    await setSettings({ linkedinEnabled: true });
    showStatus(sitesStatus, "LinkedIn enabled — reload any open LinkedIn tabs", "ok");
  } else {
    await unregisterLinkedInScript();
    await setSettings({ linkedinEnabled: false });
    try {
      await chrome.permissions.remove({ origins: LINKEDIN_ORIGINS });
    } catch {
      // Revoking is best-effort; the setting is what gates the feature.
    }
    showStatus(sitesStatus, "LinkedIn disabled", "ok");
  }
});

closeAfterSend.addEventListener("change", async () => {
  await setSettings({ closeAfterSend: closeAfterSend.checked });
  showStatus(sitesStatus, "Saved", "ok");
});

// getCurrent() resolves to a tab on the options page and to undefined in the popup.
async function inPopup() {
  try {
    return !(await chrome.tabs.getCurrent());
  } catch {
    return false;
  }
}

async function registerLinkedInScript() {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [LINKEDIN_SCRIPT_ID] });
    if (existing && existing.length) return;
  } catch {
    // Not registered yet.
  }
  await chrome.scripting.registerContentScripts([
    {
      id: LINKEDIN_SCRIPT_ID,
      matches: ["https://www.linkedin.com/*"],
      js: ["content/content.js"],
      css: ["content/content.css"],
      runAt: "document_idle",
      persistAcrossSessions: true,
    },
  ]);
}

async function unregisterLinkedInScript() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [LINKEDIN_SCRIPT_ID] });
  } catch {
    // Already gone.
  }
}

addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = addName.value.trim();
  const url = addUrl.value.trim();
  if (!name || !validWebhook(url)) return;
  const webhooks = await getWebhooks();
  webhooks.push({ id: newId(), name, url });
  await setWebhooks(webhooks);
  addName.value = "";
  addUrl.value = "";
  addForm.parentElement.removeAttribute("open");
  await renderList();
});

settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const cap = Math.max(1, Math.min(500, parseInt(sizeCap.value, 10) || 10));
  await setSettings({ dateFormat: dateFormat.value, sizeCapMb: cap, debug: debug.checked });
  showStatus(settingsStatus, "Saved", "ok");
});

function validWebhook(url) {
  return /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/.test(url);
}

async function renderList() {
  const webhooks = await getWebhooks();
  list.innerHTML = "";
  if (webhooks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted empty";
    empty.textContent = "No webhooks yet. Add one below.";
    list.appendChild(empty);
    return;
  }
  for (const w of webhooks) list.appendChild(buildRow(w));
}

function buildRow(webhook) {
  const node = tmpl.content.firstElementChild.cloneNode(true);
  node.dataset.id = webhook.id;
  const nameEl = node.querySelector(".webhook-name");
  const urlEl = node.querySelector(".webhook-url");
  const status = node.querySelector(".webhook-status");
  nameEl.textContent = webhook.name;
  urlEl.textContent = maskUrl(webhook.url);
  urlEl.dataset.real = webhook.url;
  urlEl.dataset.masked = "1";

  node.querySelector('[data-action="reveal"]').addEventListener("click", (e) => {
    if (urlEl.dataset.masked === "1") {
      urlEl.textContent = urlEl.dataset.real;
      urlEl.dataset.masked = "0";
      e.target.textContent = "Hide URL";
    } else {
      urlEl.textContent = maskUrl(urlEl.dataset.real);
      urlEl.dataset.masked = "1";
      e.target.textContent = "Show URL";
    }
  });

  node.querySelector('[data-action="test"]').addEventListener("click", async () => {
    showStatus(status, "Sending test…", "pending");
    try {
      const resp = await chrome.runtime.sendMessage({ type: "testWebhook", webhookUrl: webhook.url });
      if (resp && resp.ok) showStatus(status, "Sent ✓", "ok");
      else showStatus(status, "Failed: " + ((resp && resp.error) || "unknown"), "err");
    } catch (e) {
      showStatus(status, "Failed: " + (e.message || e), "err");
    }
  });

  node.querySelector('[data-action="rename"]').addEventListener("click", async () => {
    const next = prompt("New name", webhook.name);
    if (!next) return;
    const webhooks = await getWebhooks();
    const target = webhooks.find((w) => w.id === webhook.id);
    if (!target) return;
    target.name = next.trim();
    await setWebhooks(webhooks);
    await renderList();
  });

  node.querySelector('[data-action="delete"]').addEventListener("click", async () => {
    if (!confirm(`Delete webhook "${webhook.name}"?`)) return;
    const webhooks = (await getWebhooks()).filter((w) => w.id !== webhook.id);
    await setWebhooks(webhooks);
    await renderList();
  });

  return node;
}

function maskUrl(url) {
  // Show host + last 6 chars of token.
  const m = url.match(/^(https:\/\/[^/]+\/api\/webhooks\/\d+\/)(.+)$/);
  if (!m) return url;
  const tail = m[2];
  return m[1] + "•".repeat(Math.max(4, tail.length - 4)) + tail.slice(-4);
}

function showStatus(el, text, kind) {
  el.hidden = false;
  el.textContent = text;
  el.className = "status status-" + kind;
  if (kind === "ok") {
    setTimeout(() => { el.hidden = true; }, 2000);
  }
}

async function init() {
  const settings = await getSettings();
  dateFormat.value = settings.dateFormat;
  sizeCap.value = settings.sizeCapMb;
  debug.checked = !!settings.debug;
  closeAfterSend.checked = !!settings.closeAfterSend;

  // The permission can be revoked from chrome://extensions without touching our
  // settings, so trust the permission rather than the stored flag.
  let hasLinkedIn = false;
  try {
    hasLinkedIn = await chrome.permissions.contains({ origins: LINKEDIN_ORIGINS });
  } catch {
    hasLinkedIn = false;
  }
  linkedinEnabled.checked = !!settings.linkedinEnabled && hasLinkedIn;
  if (settings.linkedinEnabled && !hasLinkedIn) {
    await setSettings({ linkedinEnabled: false });
    await unregisterLinkedInScript();
  }

  await renderList();
}

init();
