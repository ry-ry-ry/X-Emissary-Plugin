# X Emissary

Adds a **Send to Discord** item to X's native share menu. Pick one of your saved webhooks and the post — author, text, date, images and video — lands in that Discord channel, formatted and ready to read.

No bot to host, no Discord app to authorise, no X API keys. Just webhooks.

## Features

- **Native feel** — the item is injected into X's existing share menu, styled to match.
- **Multiple destinations** — save as many webhooks as you like; the picker lets you choose per post.
- **Images and video** are re-uploaded as real Discord attachments, so they render inline instead of relying on a link preview. Oversized images are downscaled in-browser; oversized videos step down through lower-bitrate variants before falling back to a link.
- **Smart dates** — the date is parsed out of the post text where one is mentioned (ISO, slash formats, "April 30, 2026", "yesterday", "in 3 days", …) and falls back to the post's own timestamp otherwise.
- **Optional auto-translate** — a checkbox on the send dialog replaces the post text with an English translation, noting the detected source language. Ticks itself automatically when the post isn't already English. No API key needed.
- **Quote posts handled correctly** — shares the post you clicked, not the post it quotes.

## Install

**From the Chrome Web Store** — _(listing pending review; link goes here once published)_

**Unpacked, for development:**

1. Clone or download this folder.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this folder.

Works in Chrome, Edge, Brave, and other Chromium browsers.

## Setup

1. In Discord: **Server Settings → Integrations → Webhooks → New Webhook**. Pick a channel and copy the webhook URL.
2. Click the X Emissary toolbar icon to open its options.
3. Enter a **Name** (whatever you want to see in the picker) and paste the **webhook URL**, then click **Add**.
4. Click **Test** to confirm a message arrives in the channel.
5. Set the **upload size limit** to match your Discord tier:

   | Tier | Limit |
   | --- | --- |
   | Free | 10 MB |
   | Nitro Basic | 25 MB |
   | Nitro | 50 MB |
   | Server Boost level 3 | 500 MB |

## Use

1. On `x.com`, click any post's share icon.
2. Choose **Send to Discord**.
3. The dialog shows a preview and your webhook list — click a webhook to send.

## How it works

Post content comes from the public [FxEmbed / FxTwitter](https://github.com/FxEmbed/FxEmbed) API rather than by scraping the page, which keeps text and media extraction stable across X's frequent UI changes. The extension only reads the post ID from the page.

```
manifest.json                 MV3 manifest
content/                      Share-menu injection + send dialog
background/background.js      Service worker — fetches the post, posts to Discord
lib/                          fxtwitter, dateParser, mediaShrink, discord, translate, storage
options/                      Options page
icons/                        Toolbar icons
```

## Privacy

X Emissary has no backend and collects nothing. Your webhook URLs stay in your browser's extension storage. See [PRIVACY.md](PRIVACY.md) for exactly which third parties a send touches and why.

## Notes and limits

- Discord's 2000-character message limit is respected — post text is truncated with `…` and the link to the original is always preserved at the end.
- Discord allows 10 attachments per message; combined images + video are capped at 10.
- X's DOM is generated and its class names rotate, so share-menu detection uses `role="menu"` semantics plus a content heuristic. If X materially changes the menu wording, `isShareMenu` in [content/content.js](content/content.js) is the place to adjust.
- Turn on **Debug logging** in options when troubleshooting: share-menu detail goes to the page console, post fetching to the service-worker console.

## Credits

X Emissary is an independent project, built on top of services run by other people. None of the following are affiliated with this extension, and none of them sponsor or endorse it.

| Service | What it does here |
| --- | --- |
| [X](https://x.com) | The platform the posts come from. X Emissary adds an item to its share menu and reads the ID of the post you clicked. |
| [Discord](https://discord.com) | The destination. Messages and media are delivered through Discord's webhook API. |
| [FxTwitter / FxEmbed](https://github.com/FxEmbed/FxEmbed) | The open-source public API that supplies each post's text, author and media URLs. Used under its own terms — thanks to its maintainers, who do the hard part. |
| [Google Translate](https://translate.google.com) | Powers the optional "Auto-translate to English" checkbox, via Google's public translate endpoint. Contacted only when you tick the box. |

"X" is a trademark of X Corp. "Discord" is a trademark of Discord Inc. "Google" and "Google Translate" are trademarks of Google LLC. All other trademarks are the property of their respective owners. Their use here is descriptive — to say what this extension interoperates with — and does not imply any endorsement.

## Licence

_TODO: add a licence before publishing (MIT is the usual choice for this kind of extension)._
