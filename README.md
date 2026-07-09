# YawningFace 😴

**Take back your focus.** One blocking brain on every device you own —
iPhone, Mac, Windows, and your browser — free and open source.

Freedom has cross-device sync, but it's closed and paid. Brick has the
physical unlock, but it's a $59 puck that needs their server. Foqos is open
source, but iPhone-only. **Nobody offers all three. That empty triangle is
this repo.** The full argument — and the principles that keep this project
from dying like every other blocker — is in [VISION.md](VISION.md).

## How it works

One JSON document describes what gets blocked, where, and when. The cloud
stores it verbatim; **every client evaluates it locally**, offline-first.
Change it from any device — or by talking to the coach:

```
$ yf coach
you › I'm on vacation next week — relax my mornings, but my nights got bad, TikTok until 2am

Proposed change:
  ~ Stress-free mornings: windows: Every day 06:00–12:00 → Every day 09:30–12:00
  + added "Calm nights" (calm-nights): Every day 22:30–07:00 · mobile/tablet

Apply this change? [y/N]
```

The coach is **opt-in, bring-your-own-key, and optional forever** — the
config is a file you own; `yf init` and a text editor do everything the AI
does.

## Status — honest version

| App | Where | State |
| --- | --- | --- |
| **CLI + coach** (`yf`) | [`apps/cli`](apps/cli) | ✅ works today — init/show/validate/coach, 26 tests |
| **Contract** | [`packages/schema`](packages/schema) | ✅ single source of truth, Rust-parity tests |
| **Desktop** (Mac/Win tray) | [`apps/desktop`](apps/desktop) | ✅ v0.1 — hosts-file + app blocking, cloud sync, offline cache. Unsigned; no strict mode yet |
| **Cloud hub** | [`apps/cloud`](apps/cloud) | ✅ v0.1 — Next.js + Supabase + Auth0, config/devices/events/summary API |
| **iPhone** | [`apps/iphone`](apps/iphone) | ⚠️ v0.1 local-only — native Screen Time blocking that survives force-quit; not yet wired to the contract ([port notes](apps/iphone/PORT_NOTES.md)) |
| **Browser extension** | [`apps/extension`](apps/extension) | 🔜 being rebuilt on the contract (the old one shipped, but spoke its own schema) |
| **Android** | [`apps/android`](apps/android) | 🔜 planned |

## Try it in 60 seconds

```bash
npm install && npm run build
node apps/cli/dist/index.js init      # pick a starter shape
node apps/cli/dist/index.js show      # what's blocked, right now, per device
```

## Monorepo

```
packages/schema     the cross-device contract (types, validation, evaluation)
apps/cli            yf — the terminal & agent surface, incl. the opt-in coach
apps/desktop        Tauri tray app (Rust engine: hosts file, app killer, sync)
apps/cloud          the hub (Next.js + Supabase + Auth0) — self-hostable
apps/iphone         Swift + Screen Time (FamilyControls / DeviceActivity / ManagedSettings)
apps/extension      Chrome/Edge/Brave (rebuild in progress)
docs/               architecture, roadmap, style guide, competitor scan
```

Everything follows one rule learned the hard way: **a client either speaks
[the contract](packages/schema/README.md) or it doesn't merge.**

## Docs

- [VISION.md](VISION.md) — why this exists and the nine principles
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the one-brain model
- [docs/ROADMAP.md](docs/ROADMAP.md) — what's next, in order
- [docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md) — the design language
- [docs/COMPETITORS.md](docs/COMPETITORS.md) — the market, mid-2026

MIT. Built by [@EHxuban11](https://github.com/EHxuban11).
