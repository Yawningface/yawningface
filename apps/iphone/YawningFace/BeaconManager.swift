import Foundation
import Combine
import CoreLocation
import ManagedSettings

// Beacon proximity as a block trigger. The puck (apps/beacon) is a dumb iBeacon
// advertiser; we never connect to it. iOS matches the fleet UUID, and we shield
// through the same Enforcement primitives the schedule uses. See
// product/documentation/beacon.md.
//
// Engine: legacy CLLocationManager region monitoring (CLBeaconRegion). It is the
// proven background-capable beacon path (iOS 7+), works with Always
// authorization, and relaunches the app on enter/exit. We tried CLMonitor first;
// its beacon support is documented as flaky, and it forced an iOS 18 floor for
// no gain here.

// MARK: - Store

extension ManagedSettingsStore.Name {
    /// One store per zone. iOS applies the UNION of every store, so a beacon
    /// block and a schedule block coexist and neither can clear the other.
    /// The store IS the reason a thing is blocked; there is no separate flag.
    static func beaconZone(_ major: UInt16) -> ManagedSettingsStore.Name {
        ManagedSettingsStore.Name("yfBeacon\(major)")
    }
}

// MARK: - Zones

/// A place, identified by the `major` its puck advertises. `minor` distinguishes
/// pucks within a zone and is deliberately not monitored: two pucks in one
/// bedroom should both mean "bedroom".
struct BeaconZone: Codable, Identifiable, Equatable {
    var major: UInt16
    var name: String
    var enabled: Bool

    var id: UInt16 { major }
}

extension BeaconZone {
    private static let key = "beaconZones"

    static var all: [BeaconZone] {
        get {
            guard let data = Enforcement.group?.data(forKey: key),
                  let zones = try? JSONDecoder().decode([BeaconZone].self, from: data)
            else { return [] }
            return zones
        }
        set {
            let data = try? JSONEncoder().encode(newValue)
            Enforcement.group?.set(data, forKey: key)
        }
    }

    /// Seed one zone matching the puck flashed in apps/beacon (major 1), so the
    /// prototype has something to toggle without a create-zone flow yet. Starts
    /// disabled: a zone should never begin blocking before the user asks.
    static func seedDefaultIfEmpty() {
        guard all.isEmpty else { return }
        all = [BeaconZone(major: 1, name: "Bedroom", enabled: false)]
    }
}

// MARK: - Manager

@MainActor
final class BeaconManager: NSObject, ObservableObject {
    static let shared = BeaconManager()

    /// Public fleet identifier, matching FLEET_UUID in apps/beacon. Not a secret
    /// and not authentication: it is broadcast in the clear and can be cloned.
    static let fleetUUID = UUID(uuidString: "088FD0AC-A9B1-407B-A9F1-84BA43FCF681")!

    // Observable debug state, surfaced in the Beacon Zones card so a failing
    // block is diagnosable on-device without a console.
    @Published private(set) var monitoredCount = 0
    @Published private(set) var lastState: [UInt16: String] = [:]   // major -> inside/outside/unknown
    @Published private(set) var lastEvent = "none"

    private let manager = CLLocationManager()

    private override init() {
        super.init()
        manager.delegate = self
        // Region monitoring wakes the app on enter/exit in the background and
        // relaunches it if terminated, with no continuous-location updates and
        // no background-location banner. That is exactly what a beacon block
        // needs, so allowsBackgroundLocationUpdates is deliberately not set.
    }

    // MARK: Lifecycle

    /// Call from app launch and whenever zones change. No-ops when no zone is
    /// enabled, so a user who never touches beacons is never prompted for
    /// location. Region monitoring persists across relaunches at the OS level;
    /// re-registering the same identifiers on launch is how we resume.
    func resume() {
        guard BeaconZone.all.contains(where: \.enabled) else {
            stopAll()
            return
        }
        manager.requestAlwaysAuthorization()
        syncRegions()
    }

    func requestAuthorization() {
        manager.requestAlwaysAuthorization()
    }

    // MARK: Regions

    /// Reconciles monitored regions with the user's enabled zones. One region
    /// per zone with an explicit major (minor wildcarded), identifier
    /// `zone-<major>`, which maps 1:1 onto the zone's store.
    func syncRegions() {
        let zones = BeaconZone.all.filter(\.enabled)
        let wanted = Set(zones.map { Self.identifier(for: $0.major) })

        // Drop regions for zones that were disabled or deleted, and clear their
        // shields so nothing stays blocked with no region left to release it.
        for region in manager.monitoredRegions where region is CLBeaconRegion {
            if !wanted.contains(region.identifier) {
                manager.stopMonitoring(for: region)
                if let major = Self.major(from: region.identifier) {
                    ManagedSettingsStore(named: .beaconZone(major)).clearAllSettings()
                }
            }
        }

        let existing = Set(manager.monitoredRegions.map(\.identifier))
        for zone in zones where !existing.contains(Self.identifier(for: zone.major)) {
            let region = CLBeaconRegion(
                uuid: Self.fleetUUID,
                major: CLBeaconMajorValue(zone.major),
                identifier: Self.identifier(for: zone.major)
            )
            region.notifyOnEntry = true
            region.notifyOnExit = true
            manager.startMonitoring(for: region)
            // Evaluate current state immediately, so enabling a zone while
            // already next to the puck blocks now instead of on the next entry.
            manager.requestState(for: region)
        }
        monitoredCount = manager.monitoredRegions.filter { $0 is CLBeaconRegion }.count
    }

    private func stopAll() {
        for region in manager.monitoredRegions where region is CLBeaconRegion {
            manager.stopMonitoring(for: region)
            if let major = Self.major(from: region.identifier) {
                ManagedSettingsStore(named: .beaconZone(major)).clearAllSettings()
            }
        }
    }

    // MARK: Enforcement

    private func applyBlock(major: UInt16) {
        guard let selection = Enforcement.loadSelection(),
              Enforcement.hasAnyTarget(selection) else {
            lastEvent = "inside zone \(major) but NO apps selected"
            return
        }
        Enforcement.applyShield(selection, to: ManagedSettingsStore(named: .beaconZone(major)))
        lastEvent = "SHIELD applied for zone \(major)"
    }

    private func clearBlock(major: UInt16) {
        ManagedSettingsStore(named: .beaconZone(major)).clearAllSettings()
    }

    // MARK: Identifiers

    private nonisolated static func identifier(for major: UInt16) -> String { "zone-\(major)" }

    private nonisolated static func major(from identifier: String) -> UInt16? {
        let prefix = "zone-"
        guard identifier.hasPrefix(prefix) else { return nil }
        return UInt16(identifier.dropFirst(prefix.count))
    }
}

// MARK: - CLLocationManagerDelegate

extension BeaconManager: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        Task { @MainActor in
            // Once Always is granted, (re)register regions.
            if m.authorizationStatus == .authorizedAlways
                || m.authorizationStatus == .authorizedWhenInUse {
                self.syncRegions()
            }
        }
    }

    /// The single source of truth for a region's state. Fires after
    /// startMonitoring, on requestState, and on every enter/exit. Using it
    /// rather than didEnter/didExit alone means "already inside on launch" is
    /// handled the same as a fresh entry.
    nonisolated func locationManager(_ m: CLLocationManager,
                                     didDetermineState state: CLRegionState,
                                     for region: CLRegion) {
        guard let major = Self.major(from: region.identifier) else { return }
        Task { @MainActor in
            switch state {
            case .inside:
                self.lastState[major] = "inside"
                self.lastEvent = "inside zone \(major)"
                self.applyBlock(major: major)
            case .outside:
                self.lastState[major] = "outside"
                self.lastEvent = "outside zone \(major)"
                self.clearBlock(major: major)
            case .unknown:
                // Sensing not yet settled. Fail closed: leave any existing
                // shield in place rather than treat unknown as an exit.
                self.lastState[major] = "unknown"
                self.lastEvent = "unknown zone \(major)"
            }
        }
    }
}
