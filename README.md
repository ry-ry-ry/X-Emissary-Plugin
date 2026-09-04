# X Emissary

Adds a **Send to Discord** item to X's native share menu. Pick one of your saved webhooks and the post — author, text, date, images and video — lands in that Discord channel, formatted and ready to read.

No bot to host, no Discord app to authorise, no X API keys. Just webhooks.

## Features

- **Native feel** — the item is injected into X's existing share menu, styled to match.
- **Posts as the author** — each message carries the original account's name and profile picture, so a forwarded post is recognisable at a glance.
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

- Every message ends with a small `sent by x-emissary-plugin vX.Y.Z` footer. The version comes from `manifest.json` — see [CHANGELOG.md](CHANGELOG.md) for the bump convention.
- Discord's 2000-character message limit is respected — post text is truncated with `…` and the link to the original is always preserved at the end.
- Discord allows 10 attachments per message; combined images + video are capped at 10.
- X's DOM is generated and its class names rotate, so share-menu detection uses `role="menu"` semantics plus a content heuristic. If X materially changes the menu wording, `isShareMenu` in [content/content.js](content/content.js) is the place to adjust.
- Turn on **Debug logging** in options when troubleshooting: share-menu detail goes to the page console, post fetching to the service-worker console.

## LinkedIn (optional)

Off by default. Turn it on under **Sites** in the options page — it asks for access to
`linkedin.com` only at that point, and registers its content script at runtime, so a
default install still only touches X.

Once enabled, LinkedIn **post pages** (`/posts/…` and `/feed/update/…`) get a **Send to
Discord** item in the ⋯ control menu, and everything downstream — author, avatar, date,
translation, webhook picker, footer — works exactly as it does on X.

**The main feed is not supported.** LinkedIn renders the logged-in feed through a
different system: every class name is a rotating build hash and the post URN appears
nowhere in the DOM, so there is no stable anchor to inject against or identify a post
by. Open a post to share it — the **close this tab after sending** checkbox in the send
dialog makes that round trip a single step.

**Video is uploaded as a real attachment.** LinkedIn plays video from a `blob:` MSE URL,
so there is no file to grab from the player. Instead the extension reads the page's own
embedded API payload — LinkedIn ships it in `<code>` elements — which lists
`progressiveStreams`: whole, signed MP4 files. The best one that fits under your upload
cap is downloaded and re-uploaded to Discord.

If that payload isn't present, it falls back to reassembling the DASH manifest (init
plus media segments concatenated into a fragmented MP4), and finally to the poster frame
plus a link.

Every `licdn.com` URL is individually signed and bound to its exact path, so these URLs
can only be **read** from the page, never constructed. Requesting a larger avatar or a
different video rendition by editing the path returns 403.

**Video needs a full page load.** The embedded payload is server-rendered, so it is
present when you open a post directly or in a new tab, but not when you reach it by
clicking through the feed without a page load. In that case you get the poster frame and
a link. Opening posts in a new tab — which pairs well with **close the tab after
sending** — is the reliable path.

## Porting to other platforms

The exact wire format sent to Discord — payload shape, message grammar, attachment
naming, truncation and sanitising rules — is specified in
[docs/WEBHOOK_FORMAT.md](docs/WEBHOOK_FORMAT.md), so other clients can produce identical
output.

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
