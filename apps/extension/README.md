# apps/extension — being rebuilt on the contract

The previous extension
([`block_chromium`](https://github.com/Yawningface/block_chromium)) shipped to
the Chrome Web Store — but its engine redirects tabs from `tabs.onUpdated`
(weak, easily raced) and it parses **its own private dialect** of the config
(`targets` as an array, `"Mon"`/`"AllDays"` day codes). It literally cannot
read a canonical document. That schema drift is the exact failure that killed
`yawningface-v2`, so it does not get ported — it gets rebuilt.

## Rebuild spec (Phase 1)

- **Engine:** `declarativeNetRequest` rules compiled from
  [`@yawningface/schema`](../../packages/schema/README.md) evaluation —
  blocking enforced by the browser itself, no tab races, MV3-native.
- **Sync:** pull `GET /api/v1/config`, push block events; local cache so it
  works offline and without an account (same offline-first rule as every
  client).
- **Schedule:** re-evaluate on `chrome.alarms` at window boundaries;
  identical semantics to the desktop engine (the contract's tests are the
  spec).
- **Salvage, don't rewrite:** the storage layer from `block_chromium`
  (`packages/storage/lib/impl/*` — blocklist, exceptions, statistics,
  site-events, theme) is sound. The blocked page + popup follow
  [the style guide](../../docs/STYLE_GUIDE.md).
- **Cross-install taste:** the desktop app offers this extension during its
  onboarding (Apple-style, one click, no lecture).

Definition of done: a canonical config saved from `yf` or the cloud blocks
the same sites here, on desktop, and on iPhone, with no translation layer.
