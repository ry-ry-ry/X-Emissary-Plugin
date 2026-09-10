# Changelog

Versions follow [semantic versioning](https://semver.org): `MAJOR.MINOR.PATCH`.
Bump **minor** for a new user-visible feature, **patch** for a fix.

The version in `manifest.json` is the single source of truth — it is what the Chrome
Web Store reads, and what the message footer reports. The Web Store rejects an upload
whose version is not higher than the published one, so bump it on every submission.

## 1.2.1

- Fixed LinkedIn support silently doing nothing after an extension reload or update.
  The content script is registered dynamically (because LinkedIn is an optional
  permission), and those registrations are dropped on reload while the setting and the
  granted permission both survive — so options still showed it enabled while nothing was
  injected. The background now reconciles registration against the setting on install
  and on startup, and the options page repairs it on open.

- Auto-translate now falls back to other services when Google rate-limits the request
  (HTTP 429), instead of giving up. Order is Google → Lingva → MyMemory; the first that
  answers wins, and translation only reports as unavailable if all three fail.
- Lingva's reported source language is ignored — it was observed returning "en" for both
  French and Russian input. The post's own language field is used for the
  "translated from …" note instead.
- MyMemory is skipped for posts over 500 characters, its hard query limit. Truncating
  would silently drop content, so it declines rather than return a partial translation.

## 1.2.0

- **LinkedIn support**, off by default. Enable it under Sites in the options page; it
  requests access to `linkedin.com` only when you turn it on, and registers its content
  script at runtime so a default install still only touches X.
- Adds **Send to Discord** to the ⋯ control menu on LinkedIn post pages.
- **Post pages only.** LinkedIn's logged-in feed renders through a different system with
  hashed class names and no post URN in the DOM, so there is no stable anchor to inject
  against. Open a post to share it.
- LinkedIn video is re-uploaded as a real Discord attachment. The player streams from a
  `blob:` MSE URL, so the extension reads the page's embedded API payload for
  `progressiveStreams` — whole signed MP4 files — and uploads the best one that fits
  under the cap. Falls back to reassembling the DASH manifest, then to the poster frame
  plus a link. Requires a full page load, since the payload is server-rendered.
- Fixed the send dialog picking up the host page's text colour and losing its
  checkboxes. Label colour was inherited, which loses to any site rule targeting
  `span`/`label`, and sites routinely hide real checkboxes to draw their own. Colours and
  control styling are now set explicitly and scoped to the dialog.
- New **close this tab after sending** checkbox in the send dialog, for when a post was
  opened only to share it. The tab closes only when that box is ticked at send time, so
  sharing from a tab you are reading never closes it. The options page sets its default.

## 1.1.0

- Messages are now posted under the original author's name and profile picture, so a
  forwarded post looks like it came from that account.
- Every message ends with a `sent by x-emissary-plugin vX.Y.Z` footer.
- The message byline now leads with the author's `@handle`, since the display name is
  shown by Discord itself.

## 1.0.0

- Rebranded from Defense Emissary to X Emissary; new icon.
- Fixed GIF posts being attached twice: GIFs were being counted as both a photo and a
  video, and the video path could not attach them at all, so the fallback link caused
  Discord to unfurl a second copy.
- Prepared for Chrome Web Store release: privacy policy, listing copy, packaging script.

## 0.1.0

- Initial version: "Send to Discord" in X's share menu, multiple webhooks, media
  re-upload, date parsing, optional translation.
