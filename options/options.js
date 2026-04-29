import { getWebhooks, setWebhooks, getSettings, setSettings, newId } from "../lib/storage.js";

const list = document.getElementById("webhook-list");
const tmpl = document.getElementById("webhook-row-template");

const addForm = document.getElementById("add-form");
const addName = document.getElementById("add-name");
const addUrl = document.getElementById("add-url");

const settingsForm = document.getElementById("settings-form");
const dateFormat = document.getElementById("date-format");
const sizeCap = document.getElementById("size-cap");
const settingsStatus = document.getElementById("settings-status");

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
  await setSettings({ dateFormat: dateFormat.value, sizeCapMb: cap });
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
  await renderList();
}

init();
