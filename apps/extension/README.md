# apps/extension - yawningface for Chrome

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
