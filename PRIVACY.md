# Privacy Policy — X Emissary

_Last updated: 26 July 2026_

X Emissary has no backend. The developer operates no server, collects no data, and
receives nothing about you or your browsing. Everything below happens directly
between your browser and the services named.

## What the extension stores

| Data | Where | Why |
| --- | --- | --- |
| Discord webhook URLs and the names you give them | `chrome.storage.sync` | So the picker can list your destinations |
| Preferences (date format, upload size limit, debug flag) | `chrome.storage.sync` | To remember your settings |

`chrome.storage.sync` means this data is synchronised by your browser to your
browser account (Google or Microsoft) and shared across your signed-in browsers,
the same way bookmarks are. It is never sent anywhere else by this extension.

**A Discord webhook URL is a secret.** Anyone holding it can post to that channel.
The options page keeps saved URLs masked until you click **Show URL**. If a webhook
is ever exposed, delete it in Discord and create a new one.

## What is sent, and to whom, when you send a post

Nothing leaves your browser until you actively pick a webhook and send. At that
point the extension contacts, in order:

1. **`api.fxtwitter.com`** ([FxEmbed](https://github.com/FxEmbed/FxEmbed)) — receives the
   ID of the post you chose, and returns its text, author and media links. This is a
   third-party service with its own privacy practices.
2. **`twimg.com`** (X's media CDN) — the images or video attached to that post are
   downloaded so they can be re-uploaded to Discord as real attachments.
3. **`translate.googleapis.com`** — **only if** you tick "Auto-translate to English".
   The post's text is sent to Google's public translate endpoint to be translated.
   Leave the box unticked and Google is never contacted.
4. **Your Discord webhook URL** — receives the finished message: author name, post
   text (translated if you chose that), the date, the link, and the media files.

No identifiers about you are attached to any of these requests. The extension does
not add analytics, telemetry, or crash reporting of any kind.

## What the extension reads from the page

The content script runs on `x.com` and `twitter.com` only. It watches for share-menu
clicks and reads the **post ID** from the link in the post you clicked. It does not
read your timeline, your account, your messages, or anything you type.

## Permissions, and why each is needed

| Permission | Reason |
| --- | --- |
| `storage` | Save your webhooks and settings |
| `x.com`, `twitter.com` | Add the "Send to Discord" item to the share menu and read the clicked post's ID |
| `api.fxtwitter.com` | Fetch the post's text and media list |
| `*.twimg.com` | Download the post's images and video for re-upload |
| `translate.googleapis.com` | Optional translation, only when you tick the box |
| `discord.com`, `discordapp.com` webhook paths | Deliver the message to the channel you chose |

## Data sale and transfer

The developer does not sell, transfer, or share any user data — there is none to
sell. Data is not used for advertising, credit assessment, or any purpose unrelated
to the extension's single function of forwarding a post you picked to a Discord
channel you configured.

## Removing your data

Uninstalling the extension deletes its stored webhooks and settings. To also clear
the synced copy, remove the extension while signed in to the browser account you
sync with.

## Contact

Questions or reports: _add your contact email or GitHub issues URL here before publishing._
