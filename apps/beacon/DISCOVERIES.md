# Things we learned building the beacon

Hard-won findings from getting the puck + iOS block working on real hardware
(2026-07-17). Each was surprising, cost time, or contradicts what the docs imply,
so it is written down for the next person. Everything here was verified on
device, not assumed.

## Radio and the puck

**TX power is a physical radius knob; the "you can't dial the radius" advice is
about the software, not the hardware.** iOS decides you have "arrived" when the
advert crosses a signal-strength threshold, so turning the puck's transmitter
down shrinks the bubble with no API involved. Measured: `tx 0 -> +9 dBm` moved
observed RSSI from -84.9 to -74.8 dBm (a +10.1 dB shift for a +9 dB request). The
ESP32 ladder spans -12..+9 dBm, so there is ~21 dB of range control on the puck,
roughly an order of magnitude in distance. This is how you get a bedside-sized
zone instead of a whole-flat one: turn the puck down, not the app up.

**`measuredPower` must be recalibrated every time `tx` changes.** It is the RSSI
a phone sees at exactly 1 m *at the power you actually transmit*, and iOS divides
by it to estimate distance. Drop TX 9 dB without re-measuring and every distance
reading is wrong by 9 dB. Ours still ships the generic `-59` placeholder;
distances are therefore indicative only until someone calibrates.

**Build the iBeacon payload by hand, not with Arduino `BLEBeacon`.** Its
`setMajor`/`setMinor` expect a byte order that is easy to get silently wrong;
major/minor are big-endian on the wire while the Apple company ID is
little-endian. We emit the 30-byte payload directly and verified it off the air.

**The BLE MAC is the board's base MAC + 2.** An ESP32-CAM whose USB/WiFi MAC is
`...e9:f0` advertises from `...e9:f2`. Do not expect the address printed by
esptool to match what a scanner sees.

**Advertise non-connectable.** A puck has nothing to serve, so
`ADV_TYPE_NONCONN_IND` stops phones from trying to open a GATT connection.
Verified over the air as `NON_CONNECTABLE_UNDIRECTED`, `is_connectable=False`.

**You can verify the whole puck without an iPhone.** Any BLE radio decodes the
advert. `tools/scan_ibeacon.py` (via `uv run --with bleak`) prints the exact
UUID/major/minor/measured-power and an RSSI-implied distance, which is how every
firmware claim here was checked. Windows coalesces duplicate adverts, so the
adverts/second it reports is a floor, not the real 100 ms rate.

## iOS Core Location

**`CLMonitor.Event`'s diagnostics are iOS 18+, even though `CLMonitor` itself is
iOS 17+.** This is invisible in Apple's web docs and in the docs JSON; only the
compiler surfaces it. The ten diagnostic Bools (`authorizationDenied`,
`serviceSessionRequired`, ...) are what a fail-closed exit rule needs, so on iOS
17 you get monitoring with no way to tell a real exit from degraded sensing. This
is why our first design accidentally forced an iOS 18 floor.

**We abandoned `CLMonitor` for beacons and used legacy `CLBeaconRegion`.**
`CLMonitor`'s beacon support is documented as flaky (Apple forum thread "CLMonitor
Beacon Example is Nonfunctional"), and it dragged in the iOS 18 floor and the
`CLServiceSession` background-session dance for no benefit here. Region
monitoring (`startMonitoring(for: CLBeaconRegion)`, `didDetermineState`) is the
proven background beacon path since iOS 7, works with Always authorization,
relaunches the app on enter/exit, and dropped our deployment floor back to 17.
This is almost certainly what shipping apps (ScreenZen's Halo) actually use.

**Ranging is the right first smoke test, and doubles as the pairing screen.**
Before trusting the background block, prove the phone sees the puck at all with
foreground ranging (`startRangingBeacons(satisfying:)`, `CLBeacon.accuracy` in
meters). It needs only when-in-use location, updates continuously, and gives a
live distance number, exactly the "move closer to your beacon" pairing UX. It is
deprecated and foreground-only, but perfect for this.

**One region per zone with an explicit major, not one wildcard region.** A
UUID-wildcard condition reports which puck you reached via `event.refinement` on
*enter*, but on *exit* there is no refinement, so it cannot say which zone you
left. Explicit majors make enter and exit symmetric and map 1:1 onto a store.

**The block needs no `blockReason` flag.** iOS applies the union of every
`ManagedSettingsStore`, and clearing one store leaves the others intact. So a
beacon block is just its own store (`.beaconZone(major)`); a schedule ending
cannot stomp it because it never touches that store. The store *is* the reason.

**Region monitoring does not need `allowsBackgroundLocationUpdates`.** It wakes
and relaunches the app on enter/exit on its own, with no continuous-location
updates and no blue background-location banner. Setting that flag would only add
a banner and require the location background mode.

## Build infrastructure (Xcode on the headless mini)

**`actool` refuses to run with zero simulator runtimes, even for a device
build.** Delete every simulator runtime to reclaim disk and the next build,
device or simulator, dies with `No available simulator runtimes for platform
iphonesimulator. SimServiceContext supportedRuntimes=[]`, failing on the asset
catalog. Keep at least one runtime installed. Re-downloading is
`xcodebuild -downloadPlatform iOS` (~8.5 GB).

**iOS DeviceSupport is debug-only and safe to delete.**
`~/Library/Developer/Xcode/iOS DeviceSupport/<version>` (~11 GB per iOS version)
is used for symbolication when attaching a debugger. It is *not* needed to build
or to `devicectl device install`, and it regenerates on demand. It is the best
big reclaim when the build disk is full.

**The app target has no Info.plist.** It builds with
`GENERATE_INFOPLIST_FILE = YES`, so plist entries (the Core Location usage
strings, `UIBackgroundModes`) are `INFOPLIST_KEY_*` *build settings* and must be
set on both Debug and Release. Done idempotently by `add-beacon-location-keys.rb`
rather than by hand-editing `project.pbxproj`. The extensions are the opposite:
they have real Info.plist files.

**Apple's doc pages are JS-rendered, so WebFetch sees nothing.** Read the docs
JSON API instead:
`https://developer.apple.com/tutorials/data/documentation/<path>.json` (follow
the 301; e.g. `CLMonitor` lives at `corelocation/clmonitor-2r51v`). Parse it with
Python, not PowerShell, which chokes on Apple's duplicate JSON keys. Even this
does not carry per-property availability, so compile to learn that.
