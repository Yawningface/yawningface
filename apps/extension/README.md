# yawningface browser companion

This Manifest V3 extension is the browser-facing half of yawningface desktop.
It is deliberately **not a standalone blocker**.

Desktop owns sessions, schedules, active websites, native enforcement,
exceptions, and Insights. The extension mirrors that state into Chrome or Edge
so a blocked navigation is redirected before DNS. This is how a user sees the
yawningface page instead of `ERR_NAME_NOT_RESOLVED`.

## Responsibilities

- Reflect the desktop-owned active domain set with dynamic
  `declarativeNetRequest` rules.
- Show the branded blocked page for top-level HTTP/HTTPS navigation.
- Relay one normalized `site_blocked` event per blocked-page visit to desktop
  Insights.
- Accept a written reason and ask desktop for a ten-minute exception.
- Display connection and current-blocking state. It never starts or schedules
  blocking itself.

The desktop app continues enforcing its hosts rules if the extension is
missing or disconnected. When disconnected, the extension keeps the last
known rules fail-closed, but it cannot create an exception without desktop.

## Bend, don't break

The block page allows an emergency exception only after the user explains why
access is needed. Desktop validates the active block, owns the ten-minute
clock, removes the host entry, and writes the domain, reason, and duration to
Insights. After ten minutes the normal desktop engine restores the block if
its session or schedule is still active.

This interaction is inspired by the old
[`block_chromium`](https://github.com/Yawningface/block_chromium) page. Only the
product behavior was ported; the current companion and native bridge remain
the implementation and source of truth.

## Local protocol and privacy

Chrome Native Messaging host: `com.yawningface.desktop`.

The bridge exchanges:

- active normalized domains, reason labels, and optional session end time;
- blocked-domain attempts;
- explicit unblock reasons and the desktop-approved expiry; and
- aggregate focused time/unblock counts used on the local block page.

It does not read or send page contents, titles, form fields, query strings, or
browsing history. The companion has no account, server, or schedule storage.

## Build

From the repository root:

```bash
npm install
npm run build -w @yawningface/extension
```

The unpacked extension is written to `apps/extension/dist`. See
[INSTALL.md](./INSTALL.md) for manual Chrome and Edge installation and
[SPEC.md](./SPEC.md) for the protocol contract.

## Design

The UI uses the same paper, ink, yellow, Geist, Instrument Serif, and mast
engraving as desktop. The extension's `key` is pinned in `src/manifest.json` so
GitHub unpacked builds keep the allowed native-messaging identity.
