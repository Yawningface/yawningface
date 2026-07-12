---
name: ios-screentime
description: Use when working on apps/iphone or anything touching Apple Screen Time APIs (FamilyControls, DeviceActivity, ManagedSettings), the Family Controls entitlement, or NFC unlock on iOS. Encodes the Jan-2026 breakthrough so it never has to be re-learned.
---

# iOS Screen Time blocking - what we know

## The working stack (proven Jan 2026, "100% WORKING BLOCK UNBLOCK")

1. **FamilyControls**: request `.individual` authorization; let the user pick
   apps with `FamilyActivityPicker`. You get opaque `applicationTokens`  - 
   they are **device-bound and cannot sync or be created from app names**.
2. **DeviceActivity**: register `DeviceActivitySchedule`s via
   `DeviceActivityCenter`. Windows that cross midnight must be **split into
   two schedules** (`_a`/`_b` halves) - see `ScheduleManager.swift`.
3. **ManagedSettings**: inside the **DeviceActivityMonitorExtension** (a
   separate OS-run target), `intervalDidStart` sets
   `store.shield.applications = tokens`; `intervalDidEnd` calls
   `store.clearAllSettings()`. Because the OS runs the extension, **blocking
   survives force-quit** - this was the entire 2025 blocker (React Native
   could never reach these APIs).
4. **App Group** (`group.yawningface.block`): shared UserDefaults carry
   selection + schedule from app to extension. Both targets need the
   capability.

## Hard constraints - never forget

- **Physical iPhone only.** None of this works in the Simulator.
- **Both targets** need the Family Controls capability in Xcode.
- **Distribution needs Apple's Family Controls entitlement**, requested per
  bundle ID (app AND extension) via their form; lead time is **weeks**. File
  it before you need it. Development builds work without it on your own
  device.
- The #1 user bypass: Settings → Screen Time → revoke permission (or delete
  the app). Strict mode = shield the Settings app + "prevent app deletion";
  every serious competitor does this.
- `FamilyActivityPicker` is known to be crashy with very large app libraries
  (industry-wide; degrade gracefully).

## Known bugs in our snapshot (fix during Phase 1 contract adoption)

- `selectedDays` never reaches the OS - schedules are registered
  hour/minute-only with `repeats: true`. Fix via `DateComponents.weekday`
  per-day schedules or filtering in the monitor extension.
- Hard cap of 3 time periods in `ScheduleManager`.
- Sync plan: schedules + websites adopt `@yawningface/schema`;
  `applicationTokens` stay per-device (Apple design), so `targets.apps`
  names ≠ tokens - don't promise app-sync on iOS.

## NFC unlock (Phase 2, Foqos-proven pattern)

Write a universal link (`https://…/profile/<uuid>`) to a cheap NTAG as NDEF →
iOS background tag reading opens the app → app toggles its
ManagedSettingsStore. Store the **tag identity** and require the *same* tag
to unlock ("physical unblock"). Debounce ghost scans. Works with $0.30 tags;
100% offline. Shortcuts-only automations can merely toggle Focus (soft) - the
strong path is tag → app → ManagedSettings.
