# YawningFace Beacon — product & technical spec

A cheap Bluetooth **beacon puck** that auto-blocks distracting apps when your
phone is physically near it (bedroom, desk) and auto-unblocks when you walk
away. Same idea as ScreenZen's *Halo*. This doc explains exactly how it works,
what iOS APIs make it possible, and — importantly — **where in Apple's docs to
read each claim**, so the next engineer doesn't have to re-derive it.

> TL;DR: The puck is a dumb **iBeacon** advertiser (an ESP32). iOS's **Core
> Location** monitors proximity and can wake/relaunch our app on enter/exit when
> authorization and background settings permit — no pairing, no MFi, no
> persistent BLE connection. Our app then shields/unshields apps with the
> **Screen Time API** (Managed Settings), reusing the exact enforcement the
> schedule blocker already uses.

---

## 1. How it works, end to end

```
 ESP32 puck                 iOS (the OS itself)              YawningFace app
 ──────────                 ───────────────────              ───────────────
 broadcasts iBeacon   ──▶   Core Location matches the   ──▶  may wake in background
 advert (UUID/major/        registered UUID and fires        (subject to iOS policy)
 minor + measured           an enter / exit event            │
 power), forever                                              ▼
                                                        write ManagedSettingsStore
                                                        .shield  → apps blocked
                                                        clear it → apps unblocked
```

Two **independent** systems, kept deliberately separate:

1. **Proximity detection** — Core Location beacon monitoring. The puck is only
   involved here, and only as a broadcast source.
2. **Enforcement** — Apple Screen Time API (Managed Settings shields). Identical
   to our existing schedule-based blocking. The beacon is just a *new trigger*
   into the same shield.

The enforcement state must **fail closed** when sensing becomes unavailable:
once a shield is applied, `.unknown`, `.unmonitored`, denied authorization, or
radio failure must not be treated as an exit. Clear the shield only after a
genuine `.unsatisfied` transition with no failure diagnostic. This makes
turning off Bluetooth unable to directly clear an existing shield, but the
behavior still needs real-device testing on every supported iOS version.

---

## 2. The "arbitrary Bluetooth device" question (why this is even allowed)

An **iBeacon is an open advertising packet**, not a paired/connected accessory.
Any BLE radio that emits the layout below is a valid beacon to iOS. There is
**no MFi requirement, no pairing, no CBPeripheral connection** — the app never
talks *to* the puck. It registers a UUID with the OS and the OS may wake the
app. The UUID is public over the air and can be sniffed or cloned; it is an
identifier, not authentication or a shared secret.

iBeacon advertising payload the ESP32 must emit:

| Field          | Bytes | Value / meaning                                  |
| -------------- | ----- | ------------------------------------------------ |
| Company ID     | 2     | `0x004C` (Apple) — required for the iBeacon type |
| Beacon type    | 2     | `0x02 0x15`                                       |
| Proximity UUID | 16    | stable public fleet identifier (`uuidgen`)        |
| Major          | 2     | zone group (e.g. bedroom vs. desk)               |
| Minor          | 2     | specific puck                                    |
| Measured power | 1     | calibrated RSSI @ 1 m (e.g. `-59`) → drives `accuracy` |

> **Caveat (licensing, not technical):** the iBeacon *format* is Apple-licensed
> for **commercial** hardware. Irrelevant for prototypes/dev; relevant only if
> we sell our own puck. iOS detects any correctly-formatted iBeacon regardless.

**Doc source — what defines a beacon & that iOS listens even when the app isn't
running:** Apple, *Region Monitoring and iBeacon* (Location Awareness PG):
"A beacon region is an area defined by the device's proximity to Bluetooth
low-energy beacons. Beacons … simply advertise a particular Bluetooth
low-energy payload." and "regions … are tracked at all times, including when the
app isn't running. If a region boundary is crossed while an app isn't running,
that app is relaunched into the background."
<https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LocationAwarenessPG/RegionMonitoring/RegionMonitoring.html>

---

## 3. iOS API generations — pick the right one

Apple rebuilt location monitoring in iOS 17–18. Both paths work; the modern one
is what the docs now steer toward.

| Concern            | Legacy (still works)                              | Modern (iOS 17/18+)                                  |
| ------------------ | ------------------------------------------------- | ---------------------------------------------------- |
| Monitor            | `CLLocationManager.startMonitoring(for:)` + `CLBeaconRegion` | `CLMonitor` actor + `CLMonitor.BeaconIdentityCondition` |
| Enter/exit         | `didEnterRegion` / `didExitRegion` delegate       | `for await event in monitor.events` (`event.state == .satisfied`) |
| Authorization      | `requestAlwaysAuthorization()`                    | `CLServiceSession(authorization: .always)` **(now required)** |
| Deprecation status | `deprecated: 100000` (compiles clean, no warning) | recommended                                          |

`deprecated: 100000` = "will be deprecated in some future release" — the legacy
beacon path is fully usable today.

**Doc source — Core Location overview (lists Region monitoring, Beacon ranging,
CLMonitor):** <https://developer.apple.com/documentation/corelocation>

---

## 4. Monitoring (the trigger) — modern `CLMonitor`

`CLMonitor` is an **`actor`** (every call is `await`ed). Create it with a name,
add a `BeaconIdentityCondition`, iterate the async event stream:

```swift
let monitor = await CLMonitor("yawningface.beacons")
await monitor.add(
    CLMonitor.BeaconIdentityCondition(uuid: myUUID),   // wildcards major+minor
    identifier: "bedroom"
)
for try await event in await monitor.events {
    switch event.state {
    case .satisfied:   applyShield()   // inside the puck's proximity
    case .unsatisfied: clearShield()   // outside
    default: break                     // .unknown / .unmonitored
    }
}
```

Documented facts we rely on:

- **Wildcards.** `BeaconIdentityCondition` has `init(uuid:)`, `init(uuid:major:)`,
  `init(uuid:major:minor:)`. Omitted fields are wildcards → one UUID matches a
  whole fleet; major/minor distinguish zones.
  <https://developer.apple.com/documentation/corelocation/clmonitor/beaconidentitycondition>
- **Refinement.** A wildcarded condition that becomes satisfied delivers
  `event.refinement` populated with the *observed* major/minor — that's how you
  learn which puck you're near. See `CLMonitor.Event.refinement`:
  <https://developer.apple.com/documentation/corelocation/clmonitor/event>
- **20-condition cap per app** (all condition types combined). Over the limit →
  events with `.unmonitored` / the `conditionLimitExceeded` diagnostic.
  <https://developer.apple.com/documentation/corelocation/monitoring-the-user-s-proximity-to-geographic-regions>
- **Event states & diagnostics.** `event.state` ∈ `.satisfied`/`.unsatisfied`/
  `.unknown`/`.unmonitored`; each event also carries diagnostics
  (`authorizationDenied`, `authorizationDeniedGlobally`, `insufficientlyInUse`,
  `conditionUnsupported`, `accuracyLimited`, …) so you know *why* nothing fired.
  <https://developer.apple.com/documentation/corelocation/clmonitor/event>
- **Background relaunch.** "Core Location will launch your app in the background
  (if it was terminated) as long as it is authorized to receive user location.
  That means your app needs to re-init monitor and await events whenever it is
  launched." Recreate the monitor with the **same name/identifier**; monitoring
  resumes only **after the first unlock following a reboot**.
  <https://developer.apple.com/documentation/corelocation/monitoring-the-user-s-proximity-to-geographic-regions>
- **Relaunch is conditional, not guaranteed.** Apple describes the system as
  *trying* to launch the app. Turning off Background App Refresh prevents
  region-monitoring delivery and background relaunch. The product must expose
  authorization/background-health state and never promise an always-on trigger
  when those prerequisites are disabled.
  <https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LocationAwarenessPG/CoreLocation/CoreLocation.html>

**API reference — `CLMonitor`:**
<https://developer.apple.com/documentation/corelocation/clmonitor>
**WWDC23 — Meet Core Location Monitor** (fleet-UUID / major-per-site pattern,
refinements, background relaunch caveat):
<https://developer.apple.com/videos/play/wwdc2023/10147/>

### Practitioner footguns (not in the reference docs, but real)

- Do **not** rapidly destroy+recreate a `CLMonitor` with the same name → crash:
  `"Monitor named … is already in use"`. Subscribe to `.events` **once** per
  instance; mutate via `add`/`remove`.
- `CLMonitor` is flaky on the **Simulator** — verify on a real device.

---

## 5. `CLServiceSession` — the iOS 18 gotcha that WILL bite background use

This is the single most important recent change. From **WWDC24 "What's new in
location authorization"**:

> "Always authorization will only be effective when you hold [a
> `CLServiceSession` with `.always`], and you can only start holding one when
> your app is in the foreground."

> "if your app is Always authorized, liveUpdates and `CLMonitor.events` won't
> yield results when it is not in use, unless a session which was started in the
> foreground … asserts that continued interest."

Consequences for a Halo-style background trigger:

1. Background / terminated relaunch on enter/exit needs **`.always`** *and* a
   held **`CLServiceSession(authorization: .always)`**, first taken in the
   foreground.
2. On cold relaunch, Core Location preserves session state for only **"a few
   seconds after the app is launched."** Our launch path must **immediately**
   re-take the session and resume iterating `monitor.events`, or iOS decides we
   lost interest and we go silent.
3. Merely iterating `monitor.events` yields an *implicit* `.whenInUse` session —
   fine for foreground, **not** enough for background always-on.
4. Optional `NSLocationRequireExplicitServiceSession` Info.plist key forces the
   explicit-session model.

If we target iOS ≤17, `CLServiceSession` doesn't exist → use
`requestAlwaysAuthorization()` the old way (simpler; a legit reason to keep the
legacy path at a low deployment target).

**WWDC24 — What's new in location authorization:**
<https://developer.apple.com/videos/play/wwdc2024/10212/>
**Field notes on the sharp edges (session lifecycle, `NSLocationRequireExplicitServiceSession`):**
<https://twocentstudios.com/2024/12/02/core-location-modern-api-tips/>

---

## 6. Ranging (only if we want an *adjustable* radius)

Enter/exit monitoring gives a **fixed, OS-defined boundary** — you can't dial
the radius. Halo's adjustable radius needs **ranging** (live RSSI →
`CLProximity` `immediate`/`near`/`far` + `accuracy` in meters).

- Ranging is **not** in `CLMonitor`. It still uses `CLBeaconIdentityConstraint`
  + `CLLocationManager.startRangingBeacons(satisfying:)` + the `didRange`
  delegate (`deprecated: 100000`, no replacement offered).
- Apple's own sample pattern: **monitor first, range only inside enter** — "By
  monitoring for the beacon before ranging, the app is more energy efficient if
  the beacon is not immediately observable."
- Ranging is **foreground-reliable only**. Background = enter/exit, not a
  continuous RSSI stream.

Design decision for v1: **monitoring only**, accept the fixed boundary. Ranging
is a later refinement (range briefly inside the ~10 s wake window if we want to
gate on `near` vs `far`).

**Doc source — Ranging for Beacons** (sample: `CLBeaconIdentityConstraint`,
`startMonitoring` then `didRange`, "monitor before ranging" rationale):
<https://developer.apple.com/documentation/corelocation/ranging-for-beacons>
**`CLBeaconIdentityConstraint` reference (UUID + optional major/minor wildcards):**
<https://developer.apple.com/documentation/corelocation/clbeaconidentityconstraint>

### Radius is an RSSI *inference*, not geometry

RSSI ≈ inverse-square, so accuracy is decent up close and degrades fast (signal
at 20 m ≈ 100× weaker than at 2 m). iOS buckets: `immediate` ≈ ≤0.5 m,
`near` ≈ ≤3 m, `far` > 3 m. Apple deliberately named the meter estimate
`accuracy`, **not** `distance`, to discourage treating it as real distance;
recommended use is *relative* (which beacon is closest). Expect ±15 dBm jitter
(±25 dBm near metal/mirrors); `immediate` can read as 3 m. Mitigate with a
moving average and/or the phone's motion sensors (what Halo does to smooth the
laggy exit).

---

## 7. Enforcement — Screen Time API (already shipped in `apps/iphone`)

The beacon adds a trigger; the enforcement is our existing stack:

- **Managed Settings** — `ManagedSettingsStore.shield` (`ShieldSettings`) draws
  the block overlay. Set to `nil` / `clearAllSettings()` to remove. Use a
  **named** store `ManagedSettingsStore(named:)` shared via the
  `group.yawningface.block` App Group so app + extension agree.
  <https://developer.apple.com/documentation/managedsettings>
  <https://developer.apple.com/documentation/managedsettings/managedsettingsstore>
- **FamilyControls** — the `com.apple.developer.family-controls` entitlement we
  already hold; selections stay opaque `Token`s (our `BlockerModel.selection`).
  <https://developer.apple.com/documentation/familycontrols>
- **DeviceActivity** — our existing schedule path.
  <https://developer.apple.com/documentation/deviceactivity>

**Architectural subtlety:** the beacon wake cold-launches the **main app**, not
the `DeviceActivityMonitorExtension`. So the beacon handler lives in the app
target and writes the shared `ManagedSettingsStore` directly. Add a
`blockReason` flag to the App Group and **union** it with the schedule state
(shielded if *either* says so) so a schedule-unblock doesn't stomp a beacon-block.

---

## 8. iOS capabilities / Info.plist checklist

- `NSLocationWhenInUseUsageDescription` + `NSLocationAlwaysAndWhenInUseUsageDescription`
- `UIBackgroundModes` → `location` (pairs with `CLBackgroundActivitySession`
  for `whenInUse`; the `.always` region machinery handles the relaunch)
- (optional) `NSLocationRequireExplicitServiceSession`
- **No special beacon entitlement** — monitoring rides on ordinary Core
  Location. FamilyControls entitlement already present.
- Wire `BeaconManager.resume()` into `YawningFaceApp.init()` (or an
  `AppDelegate` `willFinishLaunching`) so the `CLServiceSession` is re-taken
  within the few-second launch window on background relaunch.

---

## 9. ESP32 prototype (the puck)

- ESP-IDF ships an `ibeacon` example; Arduino `BLEBeacon` does it in a few lines.
- The proximity **UUID** is a public fleet identifier (`uuidgen`), not a secret;
  `measuredPower` (~`-59`) calibrates `accuracy`.
- **Before the ESP32 arrives:** the **nRF Connect** app on a spare phone can
  emulate an iBeacon so the iOS side is testable immediately.

---

## 10. Known limitations to expect (and design around)

- **Exit lag** — enter fires in seconds; exit can take tens of seconds to
  minutes. OS-level. Halo hides it with motion sensors.
- **No background ranging** — adjustable-radius-in-background isn't really
  attainable; background = fixed OS boundary.
- **Simulator unreliable** for `CLMonitor` — test on device.
- **20-condition cap** shared app-wide.
- **Background delivery is user-controlled.** Always authorization and
  Background App Refresh must remain enabled. The app must surface degraded
  health and keep an existing shield in place when monitoring becomes unknown.
- **Beacon identity is cloneable.** UUID/major/minor are public BLE fields, so
  they identify a puck but do not authenticate it. Do not base a security or
  payment boundary on beacon identity alone.
- **iOS 18 `.always` requires a foreground-taken `CLServiceSession`**, re-taken
  instantly on relaunch — miss this and it "works in foreground, dies in
  background."

---

## Reference index (every source used)

| Topic | URL |
| --- | --- |
| Region Monitoring & iBeacon (background wake, "beacons just advertise") | <https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LocationAwarenessPG/RegionMonitoring/RegionMonitoring.html> |
| Background delivery prerequisites and Background App Refresh limitation | <https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LocationAwarenessPG/CoreLocation/CoreLocation.html> |
| iBeacon UUIDs are public and can be sniffed | <https://developer.apple.com/ibeacon/Getting-Started-with-iBeacon.pdf> |
| Core Location overview | <https://developer.apple.com/documentation/corelocation> |
| `CLMonitor` | <https://developer.apple.com/documentation/corelocation/clmonitor> |
| `CLMonitor.BeaconIdentityCondition` | <https://developer.apple.com/documentation/corelocation/clmonitor/beaconidentitycondition> |
| `CLMonitor.Event` (states, refinement, diagnostics) | <https://developer.apple.com/documentation/corelocation/clmonitor/event> |
| Monitoring proximity to geographic regions (20-cap, relaunch, reboot-unlock) | <https://developer.apple.com/documentation/corelocation/monitoring-the-user-s-proximity-to-geographic-regions> |
| Ranging for Beacons (sample: monitor-then-range) | <https://developer.apple.com/documentation/corelocation/ranging-for-beacons> |
| `CLBeaconIdentityConstraint` | <https://developer.apple.com/documentation/corelocation/clbeaconidentityconstraint> |
| WWDC23 — Meet Core Location Monitor | <https://developer.apple.com/videos/play/wwdc2023/10147/> |
| WWDC24 — What's new in location authorization (`CLServiceSession`) | <https://developer.apple.com/videos/play/wwdc2024/10212/> |
| Core Location modern API field notes | <https://twocentstudios.com/2024/12/02/core-location-modern-api-tips/> |
| Managed Settings | <https://developer.apple.com/documentation/managedsettings> |
| `ManagedSettingsStore` | <https://developer.apple.com/documentation/managedsettings/managedsettingsstore> |
| Family Controls | <https://developer.apple.com/documentation/familycontrols> |
| Device Activity | <https://developer.apple.com/documentation/deviceactivity> |
