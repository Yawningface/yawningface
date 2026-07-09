# apps/android — planned (Phase 3)

Not started. The decided approach, so nobody re-researches it:

- **Enforcement:** foreground service polling `UsageStatsManager` (~1 Hz) +
  full-screen overlay (`SYSTEM_ALERT_WINDOW`) over blocked apps — the
  TapBlok pattern (Apache-2.0 reference). Deliberately **not** an
  AccessibilityService first: Play policy treats accessibility blockers to a
  heavy disclosure/review flow; keep that as a later opt-in for reliability
  on aggressive OEMs.
- **Contract:** speaks [`@yawningface/schema`](../../packages/schema/README.md)
  from day one — config pull, event push, local evaluation, offline-first.
  (The rule: speak the contract or don't merge.)
- **NFC:** NDEF intent filter (`ACTION_NDEF_DISCOVERED`) launches the app on
  tag tap even when not running; tag UID enables same-tag-to-unlock.
- **Watch out for:** OEM battery managers killing the service (Xiaomi/Huawei
  etc.) — needs the standard battery-optimization exemption onboarding.
- Digital Wellbeing has **no public API**; there is no shortcut.

History: a 2024 exploration (`Dominus`, an OLauncher fork) proved the
launcher-level angle — grayscale nudges, uninstall suggestions. That's a
possible companion later, not the blocker.
