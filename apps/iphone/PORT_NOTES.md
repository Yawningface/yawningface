# Port notes — apps/iphone

Ported verbatim from
[`Yawningface/block_iphone`](https://github.com/Yawningface/block_iphone)
(April 2026 App-Store-ready snapshot), which polished the January 2026
`blocker_last_push` breakthrough — the commit literally titled
**"100% WORKING BLOCK UNBLOCK"**: persistent scheduled blocking that survives
force-quit. This code embodies months of hard-won Screen Time knowledge; the
UI here is also the source of [the style guide](../../docs/STYLE_GUIDE.md).

## How the hard part works (do not re-learn this)

- **FamilyControls** — `FamilyActivityPicker` yields opaque
  `applicationTokens` (device-bound; they cannot sync).
- **DeviceActivity** — `ScheduleManager` registers `DeviceActivitySchedule`s;
  midnight-crossing windows are split into `_a`/`_b` halves.
- **ManagedSettings** — the `DeviceActivityMonitorExtension` sets
  `store.shield.applications` on `intervalDidStart` and clears on
  `intervalDidEnd`. Because the *extension* is OS-run, blocking persists when
  the app is killed.
- **App Group** `group.yawningface.block` carries selection + schedule
  between app and extension.
- Build needs: a Mac, Xcode, a **physical iPhone** (no Simulator), Family
  Controls capability on **both** targets, and for distribution the
  **Family Controls entitlement** from Apple (request form, weeks of lead
  time — see [.claude/skills/ios-screentime](../../.claude/skills/ios-screentime/SKILL.md)).

## Known bugs to fix in Phase 1 (verified against this snapshot)

1. **`selectedDays` is cosmetic.** `BlockerModel.selectedDays` is stored and
   rendered, but `ScheduleManager.startSchedules()` builds schedules from
   hour/minute only with `repeats: true` — day-of-week never reaches the OS.
   Fix when adopting the contract's `schedule` arrays (either register
   per-weekday `DeviceActivitySchedule`s with `DateComponents.weekday`, or
   filter in the monitor extension).
2. **Hard cap of 3 time periods** in `ScheduleManager`.
3. **Pre-contract models.** `Models.swift` uses its own `TimePeriod` Codable,
   not [`packages/schema`](../../packages/schema/README.md). Adopt the
   contract for schedules + websites and wire `GET/PUT /api/v1/config` +
   event push. Note: `applicationTokens` stay local-only by Apple design —
   the contract's `targets.apps` (names) can't map to tokens automatically;
   sync schedules/websites, keep the token selection per-device.

## Why it's in the monorepo before it can even build here

So the code, the App Store materials (`appstore/`), and the setup guide
(`documentation.md`) live where the contract lives — and the next Mac session
starts from one `git pull`, not archaeology across three repos.
