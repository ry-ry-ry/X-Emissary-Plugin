(() => {
  const MENU_ITEM_MARK = "data-x-emissary";
  const TAG = "[XEmissary]";

  // Debug logging is controlled by the "debug" setting in the options page.
  // Loaded async from storage; defaults off until loaded, and updates live when toggled.
  let DEBUG = false;
  try {
    chrome.storage.sync.get("settings", ({ settings }) => {
      DEBUG = !!(settings && settings.debug);
      if (DEBUG) log("debug logging enabled");
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.settings) {
        DEBUG = !!(changes.settings.newValue && changes.settings.newValue.debug);
      }
    });
  } catch (e) {
    /* storage unavailable — stay off */
  }

  let lastClickedTweetId = null;
  let lastClickedAt = 0;
  const CLICK_TTL_MS = 5000;

  let shareMenuPending = false;
  let shareMenuPendingAt = 0;
  const SHARE_PENDING_TTL_MS = 5000;

  log("content script loaded on", location.href);

  // Capture the tweet ID and detect share-button clicks.
  document.addEventListener(
    "pointerdown",
    (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;

      const article = target.closest("article");
      if (article) {
        const id = findTweetIdInArticle(article);
        if (id) {
          lastClickedTweetId = id;
          lastClickedAt = Date.now();
        }
      }

      // Look for a share button: testid, aria-label, or a parent button containing a share-icon link.
      // Twitter currently uses data-testid="share" on the share button container; older variants
      // used aria-label "Share post" / "Share Tweet". We accept any match as a hint.
      const shareBtn =
        target.closest('[data-testid="share"]') ||
        target.closest('[aria-label*="Share" i]') ||
        target.closest('[aria-haspopup="menu"][role="button"]');

      if (shareBtn && article) {
        shareMenuPending = true;
        shareMenuPendingAt = Date.now();
        log("share-button click detected", {
          testid: shareBtn.getAttribute("data-testid"),
          aria: shareBtn.getAttribute("aria-label"),
          tweetId: lastClickedTweetId,
        });
      }
    },
    true,
  );

  function findTweetIdInArticle(article) {
    const links = Array.from(article.querySelectorAll('a[href*="/status/"]'));

    const idFrom = (a) => {
      const m = a.getAttribute("href").match(/\/status\/(\d{5,})/);
      return m ? m[1] : null;
    };

    if (DEBUG) {
      log(
        "links in article:",
        links.map((a) => ({
          href: a.getAttribute("href"),
          hasTime: !!a.querySelector("time"),
          inRoleLink: !!a.closest('[role="link"]'),
          // climb ancestors looking for the quote-card wrapper, whatever it is now
          ancestorRoleLink: (() => {
            let n = a.parentElement, depth = 0, found = -1;
            while (n && n !== article && depth < 40) {
              if (n.getAttribute && n.getAttribute("role") === "link") { found = depth; break; }
              n = n.parentElement; depth++;
            }
            return found;
          })(),
        })),
      );
    }

    // The embedded quoted tweet is rendered inside a div[role="link"] card.
    // Links inside it point to the *quoted* tweet, not the one being shared — skip them.
    // NOTE: X puts role="link" on the anchor elements themselves, so we must check
    // ANCESTORS only (start from parentElement) — otherwise every link looks "in a card".
    const isInQuoteCard = (el) =>
      el.parentElement ? el.parentElement.closest('[role="link"]') !== null : false;

    // 1. Preferred: the timestamp anchor (wraps a <time>) that is NOT inside the quote card.
    for (const a of links) {
      if (a.querySelector("time") && !isInQuoteCard(a)) {
        const id = idFrom(a);
        if (id) { log("picked id via timestamp-anchor", id); return id; }
      }
    }

    // 2. Fallback: any /status/ link outside the quote card.
    for (const a of links) {
      if (!isInQuoteCard(a)) {
        const id = idFrom(a);
        if (id) { log("picked id via non-quote link", id); return id; }
      }
    }

    // 3. Last resort: first /status/ link of any kind (preserves prior behaviour).
    for (const a of links) {
      const id = idFrom(a);
      if (id) { log("picked id via last-resort", id); return id; }
    }
    return null;
  }

  // Watch the whole document body for new menus.
  const observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        const menus = [];
        if (node.matches && node.matches('[role="menu"]')) menus.push(node);
        if (node.querySelectorAll) menus.push(...node.querySelectorAll('[role="menu"]'));
        for (const menu of menus) considerMenu(menu);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function considerMenu(menu) {
    if (menu.hasAttribute(MENU_ITEM_MARK)) return;

    const pendingFresh = shareMenuPending && Date.now() - shareMenuPendingAt < SHARE_PENDING_TTL_MS;
    const tweetFresh = lastClickedTweetId && Date.now() - lastClickedAt < CLICK_TTL_MS;

    if (!tweetFresh) {
      log("menu appeared but no recent tweet id");
      return;
    }

    // Use the share-pending flag if set; otherwise fall back to a content sniff
    // for resilience against Twitter UI changes that hide the share button's testid.
    const looksLikeShareMenu = pendingFresh || sniffShareMenu(menu);
    if (!looksLikeShareMenu) {
      log("menu appeared but does not look like share menu", { pendingFresh });
      return;
    }

    menu.setAttribute(MENU_ITEM_MARK, "1");
    shareMenuPending = false;
    const tweetId = lastClickedTweetId;
    log("injecting into menu", { tweetId });
    injectWhenReady(menu, tweetId);
  }

  function sniffShareMenu(menu) {
    const text = (menu.textContent || "").toLowerCase();
    return /(copy link|send via|share post|share tweet|bookmark|add tweet to bookmarks|repost via)/i.test(text);
  }

  function injectWhenReady(menu, tweetId) {
    const attempt = () => {
      if (menu.querySelector(`[data-x-emissary-item="1"]`)) return true;
      const sibling = menu.querySelector('[role="menuitem"]');
      if (!sibling) return false;
      const item = buildMenuItem(sibling);
      item.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        closeMenu(menu);
        openPicker(tweetId);
      });
      const group = sibling.parentElement || menu;
      group.appendChild(item);
      log("menu item appended", { groupTag: group.tagName, siblings: group.children.length });
      return true;
    };

    if (attempt()) return;

    // Items may stream in lazily — observe the menu and retry as children change.
    const inner = new MutationObserver(() => {
      if (attempt()) inner.disconnect();
    });
    inner.observe(menu, { childList: true, subtree: true });
    setTimeout(() => {
      inner.disconnect();
      if (!menu.querySelector(`[data-x-emissary-item="1"]`)) {
        log("gave up waiting for menu items to populate");
      }
    }, 2500);
  }

  function log(...args) {
    if (DEBUG) console.log(TAG, ...args);
  }

  function buildMenuItem(sibling) {
    let item;
    if (sibling) {
      // Clone an existing menu item to inherit Twitter's styling, then replace its label/icon.
      item = sibling.cloneNode(true);
      // Strip existing event handlers by re-creating from outerHTML wrapped in a div.
      const wrapper = document.createElement("div");
      wrapper.innerHTML = item.outerHTML;
      item = wrapper.firstElementChild;
      // Replace text content of the deepest text-bearing span.
      const textNode = findDeepestTextSpan(item);
      if (textNode) textNode.textContent = "Send to Discord";
      // Replace the leading svg icon if present.
      const svg = item.querySelector("svg");
      if (svg && svg.parentElement) svg.parentElement.replaceChild(buildIcon(), svg);
    } else {
      item = document.createElement("div");
      item.setAttribute("role", "menuitem");
      item.className = "x-emissary-menuitem";
      const icon = buildIcon();
      const label = document.createElement("span");
      label.textContent = "Send to Discord";
      item.appendChild(icon);
      item.appendChild(label);
    }
    item.setAttribute("data-x-emissary-item", "1");
    item.style.cursor = "pointer";
    return item;
  }

  function findDeepestTextSpan(root) {
    const candidates = root.querySelectorAll("span");
    let deepest = null;
    let maxDepth = -1;
    for (const span of candidates) {
      if (!span.textContent || span.children.length > 0) continue;
      let depth = 0;
      let node = span;
      while (node && node !== root) { depth++; node = node.parentElement; }
      if (depth > maxDepth) { maxDepth = depth; deepest = span; }
    }
    return deepest;
  }

  function buildIcon() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute(
      "d",
      "M20.317 4.369A19.79 19.79 0 0 0 16.558 3l-.184.34a18.27 18.27 0 0 0-5.748 0L10.443 3a19.74 19.74 0 0 0-3.76 1.369C3.07 9.86 2.196 15.176 2.62 20.422a19.94 19.94 0 0 0 6.04 3.064l.484-.665a13.6 13.6 0 0 1-2.14-1.03c.18-.131.355-.268.523-.408 4.123 1.93 8.59 1.93 12.665 0 .17.14.345.277.524.408a13.6 13.6 0 0 1-2.14 1.03l.484.665a19.94 19.94 0 0 0 6.04-3.064c.516-6.069-.83-11.34-3.783-16.053zM8.62 15.764c-1.183 0-2.155-1.094-2.155-2.434 0-1.34.954-2.434 2.155-2.434 1.21 0 2.174 1.103 2.155 2.434 0 1.34-.954 2.434-2.155 2.434zm6.76 0c-1.183 0-2.155-1.094-2.155-2.434 0-1.34.954-2.434 2.155-2.434 1.21 0 2.174 1.103 2.155 2.434 0 1.34-.945 2.434-2.155 2.434z",
    );
    svg.appendChild(path);
    return svg;
  }

  function closeMenu(menu) {
    // Click outside / dispatch Escape to dismiss the menu the natural way.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (menu.parentElement) menu.style.display = "none";
  }

  // ---------- Picker modal ----------
  let modalEl = null;

  function openPicker(tweetId) {
    closePicker();
    modalEl = document.createElement("div");
    modalEl.className = "xe-modal-backdrop";
    modalEl.innerHTML = `
      <div class="xe-modal" role="dialog" aria-label="Send to Discord">
        <div class="xe-modal-header">
          <div class="xe-title">Send to Discord</div>
          <button class="xe-close" aria-label="Close">×</button>
        </div>
        <div class="xe-preview">Loading post…</div>
        <label class="xe-translate">
          <input type="checkbox" class="xe-translate-cb" />
          <span>Auto-translate to English</span>
        </label>
        <div class="xe-webhook-list">Loading webhooks…</div>
        <div class="xe-status" hidden></div>
      </div>
    `;
    document.body.appendChild(modalEl);
    modalEl.addEventListener("click", (e) => {
      if (e.target === modalEl) closePicker();
    });
    modalEl.querySelector(".xe-close").addEventListener("click", closePicker);

    loadPreview(tweetId);
    loadWebhooks(tweetId);

    document.addEventListener("keydown", escListener, true);
  }

  function escListener(e) {
    if (e.key === "Escape") closePicker();
  }

  function closePicker() {
    if (modalEl && modalEl.parentElement) modalEl.parentElement.removeChild(modalEl);
    modalEl = null;
    document.removeEventListener("keydown", escListener, true);
  }

  async function loadPreview(tweetId) {
    if (!modalEl) return;
    const target = modalEl.querySelector(".xe-preview");
    try {
      const resp = await chrome.runtime.sendMessage({ type: "getPreview", tweetId });
      if (!modalEl) return;
      if (!resp || !resp.ok) {
        target.textContent = "Couldn't load preview: " + (resp && resp.error ? resp.error : "unknown error");
        return;
      }
      const p = resp.preview;
      const meta = [];
      if (p.photoCount) meta.push(`${p.photoCount} image${p.photoCount > 1 ? "s" : ""}`);
      if (p.videoCount) meta.push(`${p.videoCount} video${p.videoCount > 1 ? "s" : ""}`);
      const sourceTag = p.dateSource === "text" ? "from text" : "posted";
      target.innerHTML = "";
      const name = document.createElement("div");
      name.className = "xe-preview-name";
      name.textContent = p.displayName;
      const date = document.createElement("div");
      date.className = "xe-preview-meta";
      date.textContent = `${p.dateLabel} (${sourceTag})${meta.length ? " · " + meta.join(", ") : ""}`;
      const snippet = document.createElement("div");
      snippet.className = "xe-preview-snippet";
      snippet.textContent = p.snippet || "(no text)";
      target.appendChild(name);
      target.appendChild(date);
      target.appendChild(snippet);

      // Default the translate checkbox on when the post isn't already English,
      // and label it with the detected source language.
      const cb = modalEl.querySelector(".xe-translate-cb");
      const cbLabel = modalEl.querySelector(".xe-translate span");
      if (cb && p.lang && p.lang !== "en") {
        cb.checked = true;
        if (cbLabel) cbLabel.textContent = `Auto-translate to English (from ${languageName(p.lang)})`;
      }
    } catch (e) {
      target.textContent = "Couldn't load preview: " + (e.message || e);
    }
  }

  // Minimal language-code → name map for the checkbox label (mirrors lib/translate.js).
  function languageName(code) {
    const names = {
      ar: "Arabic", de: "German", es: "Spanish", fa: "Persian", fr: "French",
      hi: "Hindi", id: "Indonesian", it: "Italian", ja: "Japanese", ko: "Korean",
      nl: "Dutch", pl: "Polish", pt: "Portuguese", ru: "Russian", th: "Thai",
      tr: "Turkish", uk: "Ukrainian", vi: "Vietnamese", zh: "Chinese",
    };
    if (!code) return "another language";
    return names[code] || names[code.split("-")[0]] || code;
  }

  async function loadWebhooks(tweetId) {
    if (!modalEl) return;
    const list = modalEl.querySelector(".xe-webhook-list");
    try {
      const resp = await chrome.runtime.sendMessage({ type: "getWebhooks" });
      if (!modalEl) return;
      const webhooks = (resp && resp.webhooks) || [];
      list.innerHTML = "";
      if (webhooks.length === 0) {
        const empty = document.createElement("div");
        empty.className = "xe-empty";
        empty.textContent = "No webhooks configured.";
        const btn = document.createElement("button");
        btn.className = "xe-btn xe-btn-primary";
        btn.textContent = "Open options";
        btn.addEventListener("click", () => chrome.runtime.sendMessage({ type: "openOptions" }));
        list.appendChild(empty);
        list.appendChild(btn);
        return;
      }
      const heading = document.createElement("div");
      heading.className = "xe-webhook-heading";
      heading.textContent = "Send to:";
      list.appendChild(heading);
      for (const w of webhooks) {
        const btn = document.createElement("button");
        btn.className = "xe-btn xe-webhook-btn";
        btn.textContent = w.name;
        btn.addEventListener("click", () => sendToWebhook(tweetId, w.id, btn, getTranslateChecked()));
        list.appendChild(btn);
      }
    } catch (e) {
      list.textContent = "Couldn't load webhooks: " + (e.message || e);
    }
  }

  function getTranslateChecked() {
    const cb = modalEl && modalEl.querySelector(".xe-translate-cb");
    return !!(cb && cb.checked);
  }

  async function sendToWebhook(tweetId, webhookId, btn, translate) {
    if (!modalEl) return;
    const status = modalEl.querySelector(".xe-status");
    const buttons = modalEl.querySelectorAll(".xe-webhook-btn");
    buttons.forEach((b) => (b.disabled = true));
    btn.classList.add("xe-sending");
    status.hidden = false;
    status.className = "xe-status xe-status-pending";
    status.textContent = translate ? "Translating & sending…" : "Sending…";
    try {
      const resp = await chrome.runtime.sendMessage({ type: "send", tweetId, webhookId, translate });
      if (resp && resp.ok) {
        status.className = "xe-status xe-status-ok";
        status.textContent = "Sent ✓";
        setTimeout(() => closePicker(), 800);
      } else {
        status.className = "xe-status xe-status-err";
        status.textContent = "Failed: " + ((resp && resp.error) || "unknown error");
        buttons.forEach((b) => (b.disabled = false));
        btn.classList.remove("xe-sending");
      }
    } catch (e) {
      status.className = "xe-status xe-status-err";
      status.textContent = "Failed: " + (e.message || e);
      buttons.forEach((b) => (b.disabled = false));
      btn.classList.remove("xe-sending");
    }
  }
})();
