# Changelog

Versions follow [semantic versioning](https://semver.org): `MAJOR.MINOR.PATCH`.
Bump **minor** for a new user-visible feature, **patch** for a fix.

The version in `manifest.json` is the single source of truth — it is what the Chrome
Web Store reads, and what the message footer reports. The Web Store rejects an upload
whose version is not higher than the published one, so bump it on every submission.

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
