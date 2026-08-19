# X Emissary — Discord webhook message format

**Spec version 1.1.0** — matches the Chrome extension at `manifest.json` v1.1.0.

Reference for other clients (Android, Telegram bridge, …) that post to Discord so their
output is byte-identical to the browser extension's. Everything here is derived from
[`lib/discord.js`](../lib/discord.js) and `sendTweet()` in
[`background/background.js`](../background/background.js); those files are the source of
truth if the two ever disagree.

---

## 1. Transport

A single `POST` to the user's webhook URL, always `multipart/form-data` — even with no
files, so there is one code path.

```
POST https://discord.com/api/webhooks/{id}/{token}
Content-Type: multipart/form-data; boundary=...
```

Form fields:

| Field | Content |
| --- | --- |
| `payload_json` | The JSON object from §2, serialised |
| `files[0]`, `files[1]`, … | One part per attachment, in the same order as `payload_json.attachments` |

No auth header. The token in the URL is the credential. Treat it as a secret.

## 2. Payload JSON

```jsonc
{
  "content": "…",                    // always present, may be ""
  "username": "Jane Doe",            // omitted when empty (see §5)
  "avatar_url": "https://pbs.twimg.com/profile_images/…_200x200.jpg", // omitted when null
  "attachments": [                   // omitted when there are no files
    { "id": 0, "filename": "image-1.jpg" },
    { "id": 1, "filename": "video-1.mp4" }
  ],
  "embeds": [ … ]                    // omitted when empty (see §7)
}
```

`attachments[].id` **must** match the numeric index in the `files[n]` field name.

Only include a key when it has a value. Sending `"username": null` is not equivalent to
omitting it.

## 3. Message content grammar

`content` is assembled in this exact order, then truncated as §6 describes.

```
content       := truncate(header + body, tail)

header        := "**" byline "** — " dateLabel postedSuffix
byline        := "@" screenName            if screenName is non-empty
               | displayName               otherwise
postedSuffix  := " (posted)"               if the date came from the post timestamp
               | ""                        if the date was parsed out of the post text

body          := ""                        if the post has no text
               | "\n\n" text translationNote

translationNote := ""                                                  if not translated
               | "\n*— translated from " LanguageName "*"              on success
               | "\n*— translation unavailable (" errorMessage ")*"    on failure

tail          := link videoSuffix footer
link          := "\n\n<" postUrl ">"
videoSuffix   := ""                        if every video was attached
               | "\n📹 " urls              urls = de-duplicated, space-separated
footer        := "\n-# sent by x-emissary-plugin v" version
```

Notes:

- The header separator is an **em dash** `—` (U+2014) with a space either side. The
  translation note also opens with an em dash inside the italics.
- `-#` is Discord's subtext markdown — small grey text. It must start its own line.
- The post URL in `link` is wrapped in `<…>` to suppress Discord's own link preview,
  because the media is already attached. The URLs in `videoSuffix` are deliberately
  **not** wrapped, so Discord unfurls them and the video is still watchable inline.
- `dateLabel` is either parsed from the post's text or falls back to its timestamp;
  see §8.

### Worked example

```
**@janedoe** — April 29, 2026

Look at this thing I found in the garden
*— translated from Japanese*

<https://x.com/janedoe/status/1234567890>
-# sent by x-emissary-plugin v1.1.0
```

## 4. Attachments

Media is re-uploaded as real Discord attachments rather than linked, so it renders
inline even if the source later disappears.

**Order:** all images first, then all videos.

**Naming:** `image-{n}{ext}` and `video-{n}.mp4`, where `n` is 1-based **per media type**
(so a post with two images and one video yields `image-1`, `image-2`, `video-1`).

Image extension comes from the downloaded blob's MIME type — `.png`, `.jpg`, `.gif`,
`.webp` — falling back to the extension in the source URL, then to `.jpg`.

**Cap:** 10 attachments per message total, images and videos combined. This is Discord's
limit, not ours.

**Size:** the user configures a byte cap matching their Discord tier (default 10 MB;
25/50/500 MB for the paid tiers). Then:

- **Images** over the cap are downscaled and re-encoded client-side. If still over, the
  image is dropped from `files` and added to `embeds` instead (§7).
- **Videos** are tried in descending bitrate order; the first variant under the cap is
  attached. If none fit, nothing is attached and the post URL goes into `videoSuffix`.

**GIFs:** the source API classifies a GIF as a *video* with `type: "gif"`. Treat it as a
video and nothing else. Counting it as both a photo and a video attaches it twice — this
was a real bug in v0.1.0. Note that a GIF entry often has no per-bitrate variant list, so
fall back to the media entry's top-level `url`.

## 5. Username and avatar

The message is posted under the **post author's** name and profile picture, so a
forwarded post is recognisable at a glance.

- `avatar_url` — the author's avatar URL, passed through unmodified. Discord fetches it
  server-side, so the client needs no permission for that host.
- `username` — the author's display name, after sanitising:

  1. Remove every case-insensitive occurrence of `discord` and `clyde`. Discord rejects
     usernames containing either with **HTTP 400**, and X display names are arbitrary.
  2. Collapse runs of whitespace, then trim.
  3. If the result is empty, apply the same treatment to the author's `@handle` and use
     that instead.
  4. Truncate to **80** characters.
  5. If the result is *still* empty, omit `username` entirely — Discord then uses the
     webhook's own configured name.

  A send must never fail because of an author's name.

## 6. Limits and truncation

`content` has a hard limit of **2000 characters**. The tail (link, video URLs, footer) is
always preserved — only the post text is sacrificed:

```
limit = 2000 - length(tail)
if length(text) <= limit:  result = text + tail
else:                      result = text[0 : max(0, limit - 1)] + "…" + tail
```

The `…` is a single character (U+2026), which is why the slice is `limit - 1`.

> **Porting caveat.** The reference implementation measures length in UTF-16 code units,
> because that is what JavaScript's `String.length` returns. Discord counts Unicode
> codepoints, so for text containing emoji or non-BMP characters the JS version truncates
> slightly earlier than it strictly needs to — harmless, but your platform's native string
> length may not match it exactly. If you need byte-identical output, count UTF-16 units.
>
> Related known issue: slicing at an arbitrary UTF-16 index can split a surrogate pair and
> leave a lone half at the cut point. Trim a trailing lone surrogate after slicing; the
> extension does not do this yet.

## 7. Embed fallback

Embeds are used **only** for an image that could not be attached — too large even after
downscaling, or the download failed. One embed per such image:

```json
{ "url": "https://pbs.twimg.com/media/….jpg", "image": { "url": "https://pbs.twimg.com/media/….jpg" } }
```

Discord then loads the image from source. There is no embed for the message body — the
text lives in `content`. Do not move the footer into an embed footer; it belongs in
`content` so it survives when there are no embeds.

## 8. Date label

The date shown in the header is parsed out of the post's **text** where one is mentioned,
and falls back to the post's own timestamp. `(posted)` is appended only in the fallback
case, so a reader can tell the two apart.

Recognised in text, in priority order: ISO `2026-04-29`; slash `29/04/2026` (day-first
when the first number is > 12); `April 29, 2026` / `Apr 29`; `29 April 2026` /
`29th of April`; and relative expressions — `today`, `tomorrow`, `yesterday`,
`N days/weeks ago`, `in N days/weeks`, `next|last week/month/year`. Relative expressions
resolve against the post's timestamp, not the current time. All arithmetic is UTC.

Label formats, user-selectable: `April 29, 2026` (long, default), `Apr 29, 2026` (short),
`2026-04-29` (ISO).

## 9. Response handling

Success is any 2xx (Discord returns **204 No Content**, or 200 with the message object if
`?wait=true` — the extension does not use `wait`).

On failure, surface `status` and response body together; Discord's error bodies are
specific and worth showing the user. Common ones:

| Status | Meaning |
| --- | --- |
| 400 | Malformed payload, or a blocked word in `username` (see §5) |
| 401 / 404 | Webhook deleted or token wrong — tell the user to re-add it |
| 413 | Payload over the size cap for that server's tier |
| 429 | Rate limited; honour `retry_after` in the body |

## 10. Deliberate omissions

- **`allowed_mentions` is not set.** Discord therefore honours mentions in the post text,
  so a forwarded post containing `@everyone` or `@here` **will** ping the channel if the
  webhook has permission. Setting `"allowed_mentions": {"parse": []}` suppresses all
  pings. Whichever way you decide, decide it the same way across clients — this is the
  one place where the current format has a real safety edge.
- **No `thread_id`, `tts`, `flags`, or components.** Plain webhook messages only.
- **No `wait=true`.** The client does not need the created message object back.

## 11. Client identifier in the footer

The footer names the client that sent the message. Keep the shape and change the
identifier per platform:

```
-# sent by x-emissary-plugin v1.1.0      ← Chrome / Edge extension
-# sent by x-emissary-android v1.0.0     ← suggested
-# sent by x-emissary-telegram v1.0.0    ← suggested
```

Versions are independent per client and follow semver. The version string must come from
the build's own manifest rather than a hardcoded constant, so it cannot drift.

## 12. Conformance checklist

- [ ] `multipart/form-data`, with `payload_json` plus `files[n]` parts
- [ ] `attachments[].id` matches the `files[n]` index
- [ ] Optional keys omitted, never null
- [ ] Content assembled in the §3 order, em dashes included
- [ ] Post URL wrapped in `<>`; link-only video URLs left bare
- [ ] Footer is the last line, prefixed `-# `
- [ ] Tail preserved when truncating to 2000
- [ ] Images before videos; 1-based per-type numbering; 10 total maximum
- [ ] GIFs treated as videos only, never also as photos
- [ ] `username` sanitised per §5 and capped at 80
- [ ] Oversized or failed images fall back to embeds, not silent loss
- [ ] Non-2xx surfaces both status and body
