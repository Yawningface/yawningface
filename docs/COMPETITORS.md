# The market, mid-2026 — and the empty triangle

Three moats exist. Nobody holds all three; we aim at the center.

| Moat | Held by | Their weakness |
| --- | --- | --- |
| Cross-device sync | **Freedom** ($39.99/yr) | closed, paid, dated, no physical story |
| Physical unlock | **Brick** ($59 puck) | needs internet to toggle, 5 lifetime emergency unlocks, pairs only to their token |
| Open source | **Foqos** (iOS, MIT) | iPhone-only, no sync, no desktop |

## Software blockers

| App | Platforms | Price | Signature move |
| --- | --- | --- | --- |
| Freedom | Win/Mac/iOS/Android/ext | $39.99/yr | sessions fan out to all devices (our target to beat, free) |
| Cold Turkey | Win/Mac | $39 one-time | "Frozen Turkey" locks the whole computer; near-unbypassable on Windows |
| Opal | iOS/macOS | $99.99/yr | **friends leaderboard + Buddies** (off-track → your friend gets a text) |
| one sec | iOS/Android | freemium | forced breathing pause before the app opens; peer-reviewed −57% openings |
| ScreenZen | iOS/Android | **free** (donations) | per-open pauses/limits; proof that free can win hearts |
| Jomo | Apple | $29.99/yr | strictness levels; AI photo-proof unlock ("show me you're at the gym") |
| Roots | iOS | $59.99/yr | Monk Mode — no workaround overrides |
| Clearspace | iOS | sub | pushups convert to screen minutes |
| Forfeit | iOS/Android | stakes | bet real money on staying under your limit |

## Physical tokens

| Product | Price | Mechanism | Catch |
| --- | --- | --- | --- |
| Brick | $59 one-time | NFC puck + Screen Time | **requires internet to (un)brick**; token pairing = lock-in |
| Unpluq | ~$26.50 tag **+ $60/yr** | NFC tag on carabiner | the tag is useless without the subscription |
| Bloom | $39 one-time | steel NFC card | finicky scans |
| Blok | $29 **+ $59.99/yr** | NFC card/keychain | subscription on top of hardware |
| ScreenZen Halo | $49 one-time | **BLE beacon zone** (room-level, e.g. "in bed") | new; zone model, not tap model |
| Aro | $350 + $19.99/mo | lockbox | price |

**Our answer:** any $0.30 NTAG sticker. The press already writes "the $9 DIY
Brick" tutorials — the demand for exactly our free version is organic. The
load-bearing details to copy (all proven by Foqos, MIT, iOS):

- **Same-tag-to-unlock** — store the tag identity; only *that* tag ends the
  session (`physicalUnblockNFCTagId` pattern)
- Background tag read via a universal-link NDEF record → app opens → toggles
  ManagedSettings shields
- **Strict mode** = prevent app deletion + shield Settings (the #1 bypass on
  iOS is revoking the Screen Time permission)
- **100% offline** — never require a server to block or unblock
- Generous emergency-unlock policy (Brick's 5-per-lifetime is a hostage
  mechanic, not safety)
- Debounce NFC ghost scans

Android references: TapBlok (Apache-2.0; UsageStats polling + overlay —
avoids accessibility-policy friction), nfcGuard (accessibility route).

## The AI landscape — why the coach is novel

Everything shipped so far is an **AI doorman**: Zario (negotiate extra time in
chat, $2 to override), LOCKR (daily check-ins, reason-judging), Zensi
("conversational boundaries"), ScreenCoach, Superhappy. All iOS-first, all
argue about **one unlock moment**.

**Nobody ships an AI that rewrites the durable config across devices** ("I'm
on vacation next week — relax mornings, keep evenings strict"). Opal states
it's not AI-driven; Freedom and Cold Turkey have zero AI. The coach — a
tailor for the rules, not a bouncer at the door — is first-of-kind as of
mid-2026. That, plus free + open + physical, is the wedge.

## Location-based blocking

AppBlock (radius + inverse-radius rules), Geolock/GymLock/GeoFocus
(2025–26 wave). iOS mechanism: CoreLocation region monitoring wakes the app →
it toggles its ManagedSettingsStore. Caveats: minutes of latency, ~100m
granularity, "Always" location permission. ScreenZen Halo's BLE beacon covers
the room-level indoor case GPS can't. A three-tier context system — NFC tap /
BLE room / GPS zone — exists nowhere as one product. (Phase 3.)
