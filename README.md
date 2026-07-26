# Defense Emissary

A Microsoft Edge / Chromium browser extension that adds a **Send to Discord** item to Twitter/X's native Share menu. Picks a webhook from your configured list, then posts the tweet's display name, text, an approximate date, and any images/videos to that Discord channel.

## Features

- Injects into Twitter's existing Share menu — feels native.
- Multiple named webhooks; the picker lets you choose where each tweet goes.
- **Approximate date**: parsed from the tweet text first (ISO, slash, "April 30, 2026", "yesterday", "in 3 days", …); falls back to the tweet's posted timestamp when no date is mentioned.
- **Images** are uploaded as native Discord attachments (inline gallery). Anything over your size threshold is downscaled in-browser via canvas re-encoding.
- **Videos** are uploaded as MP4 attachments at the highest bitrate that fits under your size threshold; if no variant fits, the message gets a link to the original tweet instead.
- **Auto-translate** (optional, free): an "Auto-translate to English" checkbox on the send popup. When ticked, the tweet text is replaced with its English translation (the detected source language is noted). Uses Google's free unofficial translate endpoint — no API key, no budget. Defaults on automatically when the post isn't already English.
- All tweet content sourced from the [FxEmbed/FxTwitter](https://github.com/FxEmbed/FxEmbed) public API — no Twitter API keys, no scraping fragility for text/media. DOM scrape is the fallback only.

## Install (unpacked)

1. Clone or download this folder.
2. Open `edge://extensions` (or `chrome://extensions`).
3. Toggle **Developer mode** on.
4. Click **Load unpacked** and select this folder.
5. Click the toolbar icon (or right-click → Options) to open the options page.

## Setup

1. In Discord: server settings → **Integrations** → **Webhooks** → **New Webhook**, pick a channel, copy the webhook URL.
2. In the extension's options page: enter a **Name** (anything you want — appears in the picker) and the **Discord webhook URL**, click **Add**.
3. Click **Test** on the newly added webhook to confirm a message lands in Discord.
4. Set your **Discord upload size limit** to match your current Discord tier:
   - 10 MB — free (default)
   - 25 MB — Nitro Basic
   - 50 MB — Nitro
   - 500 MB — Nitro Server Boost level 3

## Use

1. On `twitter.com` or `x.com`, click any tweet's share icon.
2. Pick **Send to Discord** from the menu.
3. The picker shows a preview, the parsed/approximate date, and your webhook list. Click a webhook to send.

## File layout

```
manifest.json                 MV3 manifest
content/                      Twitter UI injection + picker modal
background/background.js      Service worker — orchestrates fetch + post
lib/                          fxtwitter, dateParser, mediaShrink, discord, storage
options/                      Extension options page
icons/                        Toolbar icons
```

## Notes

- Twitter's DOM is generated and class names rotate; the share-menu detection uses `role="menu"` semantics + a content heuristic ("Copy link", "Bookmark", etc.). If Twitter changes the menu copy materially, the heuristic in `content/content.js#isShareMenu` may need a tweak.
- Discord 2000-character message limit is respected (the link to the original tweet is always preserved at the end; tweet text is truncated with `…` if needed).
- Up to 10 attachments per Discord message — the extension caps total images + videos at 10.
