# apps/extension - yawningface for Chrome

A detailed implementation, desktop-bridge, privacy, testing, and distribution
contract lives in [SPEC.md](./SPEC.md). Manual Chrome and Edge instructions are
in [INSTALL.md](./INSTALL.md).

A client of the contract, not a product of its own. It evaluates the same
[`@yawningface/schema`](../../packages/schema/README.md) document the desktop
app, the phone and the `yf` CLI evaluate, then compiles the result into
**declarativeNetRequest** rules, so the browser itself does the blocking. No
tab races from `tabs.onUpdated`, no private dialect of the config: those were
the two failures that killed the old
[`block_chromium`](https://github.com/Yawningface/block_chromium), and neither
is repeated here.

## What it does

- **The toolbar icon is the switch.** One click starts a working session
  (30 min / 1 h / 2 h / no limit); the badge goes yellow while it blocks. Same
  gesture as the tray icon on the desktop.
- **Schedules**, in the canonical shape: days, time windows, site lists. A
  routine that starts without you.
- **The blocked page is the product.** Odysseus lashed to the mast (the same
  engraving the website uses), "You asked me to stop you", the reason it is
  blocked, when it ends, how long you have focused today, and how many times
  you came back to this exact site. Honest, not preachy.
- **Focused time is measured**, one elapsed minute at a time, never estimated,
  exactly like the desktop app's Insights.

## The ecosystem, concretely

The options page exports and imports `yawningface.json`: the same document the
desktop app enforces (`%APPDATA%\org.yawningface.block.desktop\yawningface.json`)
and the same one `yf` edits. Export from one, import into the other, and both
block the same things. No account, no server, no sync service required.

## Signed in, or an island

Signing in is optional and it is the only thing that connects this browser to
the rest of the account. Signed out, the extension is an island: it blocks from
`chrome.storage.local`, keeps its own history, and never makes a network
request. That is a supported way to use it, not a degraded one.

Signed in, it becomes the fourth client of the same three endpoints the desktop
app already speaks to:

| It does | Endpoint | So that |
| --- | --- | --- |
| registers this browser | `POST /api/v1/devices` (`platform: "extension"`) | Chrome appears next to the Mac and the phone in the devices table |
| pulls the account's config | `GET /api/v1/config` | a schedule written on one device blocks on all of them |
| ships what happened | `POST /api/v1/events` | focused time and refusals reach Insights |

Two rules make this safe to turn on:

- **The cloud config is pulled, never pushed.** The document you edit here is
  the local one, and the account's document is merged on top of it, exactly as
  the desktop app merges its own local `yawningface.json`. Two clients
  last-write-winning a shared document every 60 seconds is how you lose a
  blocklist you meant to keep.
- **Merging is additive.** Signing in can only ever block more. It can never
  quietly unblock something you were relying on.

Events are queued in local storage and flushed on the next tick, so a flight,
a tunnel or a server having a bad day costs you nothing: a batch that fails to
deliver goes back on the queue. An event that never arrives is a lie in a chart
later.

### Auth0 setup (once)

Login is **Authorization Code with PKCE** through `chrome.identity.launchWebAuthFlow`,
not the desktop's Device Flow: a browser has somewhere good to land a redirect,
and a native app does not. There is no client secret, and there must never be
one. An extension is a public client and everything shipped inside it is public.

The redirect URI is derived from the extension id, which is derived from the
`key` pinned in `src/manifest.json`. That key is why the id does not move when
the extension is loaded from a different path or a different machine, and why
the callback URL registered in Auth0 keeps matching.

In the Auth0 dashboard, on a **Native** application (public client, PKCE):

- **Allowed Callback URLs**: `https://pbpgbdnamekjeifocnifopkecnphchjb.chromiumapp.org/`
- **Refresh Token Rotation**: on, with **Absolute Expiration** off, so a signed-in
  browser stays signed in.
- The API (audience) needs **Allow Offline Access**, which it already does for
  the desktop app.

The options page prints the exact callback URL it will use, so there is no need
to trust this README over the running code.

### Pointing it at the tenant

Same story as the desktop app's Settings: baked in at build time, overridable at
runtime.

```bash
YF_API_BASE=https://block.yawningface.org \
YF_AUTH0_DOMAIN=yawningface.eu.auth0.com \
YF_AUTH0_CLIENT_ID=… \
YF_AUTH0_AUDIENCE=https://block.yawningface.org/api \
npm run build -w @yawningface/extension
```

Build without them and nothing breaks: the extension simply has no server to
sign in to, and the options page asks for the four values under **Connection**.

## Build and load

```bash
npm install          # from the repo root (workspaces)
npm run build -w @yawningface/extension    # -> apps/extension/dist
```

Then in Chrome: `chrome://extensions` -> Developer mode -> **Load unpacked** ->
select `apps/extension/dist`.

Chrome has removed the `--load-extension` command-line flag, so a script can no
longer side-load it: it has to be the Developer mode button.

## Design

The same system as everything else: paper `#faf9f4`, ink `#12120f`, one yellow
`#f0db0c`, Geist for the UI, Instrument Serif only where the brand gets to
speak (the blocked page's headline). See
[the style guide](../../docs/STYLE_GUIDE.md).
