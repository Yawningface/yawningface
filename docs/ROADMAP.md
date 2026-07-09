# Roadmap

## ⚡ Do first, regardless of everything else

- [ ] **Request Apple's Family Controls distribution entitlement** for the
  final bundle IDs (app + monitor extension). It's a per-bundle-ID request
  form with weeks of lead time — the longest pole in the whole project.
  See [.claude/skills/ios-screentime](../.claude/skills/ios-screentime/SKILL.md).
- [x] Coach endpoint: defaults now point at OpenRouter's free tier — a $0
  key runs `yf coach` end-to-end (verified live on the 550B free model).

## Phase 0 — the founding commit ✅

- [x] Monorepo with real workspace tooling (npm workspaces, shared tsconfig, CI)
- [x] `packages/schema` — the contract as one package: types, two-tier
  validation, evaluation with Rust-parity tests (16 tests)
- [x] `apps/cli` — `yf init/show/validate/coach`, zero runtime deps (10 tests)
- [x] The coach: constitution prompt, proposal→validate→diff→confirm→apply
  loop, proven end-to-end
- [x] Ports: cloud (v0.1), desktop (v0.1), iphone (v0.1 local-only)
- [x] Founding docs: VISION, ARCHITECTURE, STYLE_GUIDE, COMPETITORS
- [x] Claude skills for future sessions (`.claude/skills/`)

## Phase 1 — integrate: one schedule on every device, for real

*Rule: a client either speaks the contract or it doesn't merge.*

- [ ] Cloud: consume `@yawningface/schema` directly (kill the duplicate in
  `apps/cloud/lib/schema.ts`); add per-user RLS policies (currently
  service-role only)
- [ ] iPhone: **fix the `selectedDays` bug** (days are stored and shown but
  never reach `DeviceActivitySchedule` — see
  [PORT_NOTES](../apps/iphone/PORT_NOTES.md)); adopt the contract for
  schedules/websites; pull config + push events
- [ ] Extension: rebuild on `declarativeNetRequest` + the contract + cloud
  sync (salvage the storage layer from `block_chromium`; retire the
  tab-redirect engine and its private dialect)
- [ ] Desktop: strict mode (quitting the app must not silently unblock),
  signed builds
- [ ] Working session v1: `yf session start 2h` + desktop tray button →
  ephemeral block-everything fan-out

## Phase 2 — the differentiators nobody has

- [ ] **Coach everywhere**: same constitution + config loop inside the
  desktop app; "how did I do this week?" answered from `/api/v1/summary`
- [ ] **Smart friction / contract v2**: `exceptions` with written reason +
  expiry; unlock friction that grows with abuse; the "Moment of Weakness"
  flow generalized
- [ ] **NFC**: cheap generic tags as block/unblock keys, Foqos-style
  same-tag-to-unlock, 100% offline
- [ ] **Social**: opt-in screen-time sharing with friends (the Opal
  leaderboard, minus the $99/yr)
- [ ] Apple-grade cross-install: desktop app offers the extension; iPhone
  onboarding pairs the phone via QR (Freedom's flow, our taste)

## Phase 3 — breadth

- [ ] Android (UsageStats + overlay pattern), App Store / Chrome Web Store
  submissions, geofence rules (gym relaxes, library tightens), BLE room
  zones, self-host one-liner (docker compose)

## Non-goals (permanent)

Productivity-suite features — pomodoro, music, notes, widgets. That sprawl
killed the 2025 run. If it doesn't reduce unwanted screen time, it doesn't
merge. ([VISION.md](../VISION.md#non-goals))
