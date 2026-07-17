import SwiftUI
import Combine
import CoreLocation
import FamilyControls

// The beacon zones surface: pick apps, request Always location, then a list of
// zones the user can toggle. A zone is "the puck advertising this major is
// nearby -> block". Enforcement and monitoring live in BeaconManager; this is
// only UI.

@MainActor
final class LocationAuthModel: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var status: CLAuthorizationStatus
    private let manager = CLLocationManager()

    override init() {
        status = manager.authorizationStatus
        super.init()
        manager.delegate = self
    }

    /// Always is what background beacon delivery needs. iOS shows the
    /// when-in-use prompt first and only offers "Always" later, on its own
    /// schedule; that is Apple's flow, not something we can skip.
    func request() { manager.requestAlwaysAuthorization() }

    nonisolated func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        Task { @MainActor in self.status = m.authorizationStatus }
    }
}

struct BeaconZonesView: View {
    @StateObject private var auth = LocationAuthModel()
    @ObservedObject private var beacon = BeaconManager.shared
    @State private var zones: [BeaconZone] = []
    @State private var showSignalTest = false
    @State private var showAppPicker = false
    @State private var selection = FamilyActivitySelection()
    @State private var blockedCount = 0
    @State private var screenTimeOK = AuthorizationCenter.shared.authorizationStatus == .approved

    var body: some View {
        VStack(alignment: .center, spacing: 15) {
            Text("Beacon Zones")
                .font(.title2).fontWeight(.bold)
                .foregroundColor(normalTextColor)

            Text("Block apps when your phone is near a puck. A zone stays blocked while you are in the room and clears when you leave.")
                .font(.caption)
                .foregroundColor(normalTextColor.opacity(0.6))
                .multilineTextAlignment(.center)
                .padding(.horizontal)

            if auth.status != .authorizedAlways {
                Button(action: { auth.request() }) {
                    Text(auth.status == .notDetermined ? "Allow Location" : "Allow \"Always\" Location in Settings")
                }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal)

                Text(authHint)
                    .font(.caption2)
                    .foregroundColor(normalTextColor.opacity(0.5))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            // Which apps a zone blocks. Shared with the schedule selection, so a
            // zone blocks whatever the app is already set to block.
            Button(action: { showAppPicker = true }) {
                HStack {
                    Image(systemName: "apps.iphone")
                        .foregroundColor(normalTextColor)
                    Text(blockedCount > 0 ? "Blocking \(blockedCount) apps/categories" : "Choose apps to block")
                        .foregroundColor(normalTextColor)
                }
            }
            .buttonStyle(CardButtonStyle())
            .padding(.horizontal)

            ForEach(zones) { zone in
                zoneRow(zone)
            }
            .padding(.horizontal)

            if !screenTimeOK {
                Button("Enable Screen Time Blocking") { requestScreenTime() }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.horizontal)
                Text("Blocking apps needs Screen Time permission. Without it a zone senses the puck but cannot block.")
                    .font(.caption2)
                    .foregroundColor(normalTextColor.opacity(0.5))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            // On-device diagnostics: makes a failing block legible without a
            // console. Remove once the flow is trusted.
            VStack(alignment: .leading, spacing: 4) {
                debugRow("Location", locationLabel)
                debugRow("Screen Time", screenTimeOK ? "approved" : "NOT approved")
                debugRow("Apps selected", "\(blockedCount)")
                debugRow("Regions monitored", "\(beacon.monitoredCount)")
                debugRow("Zone 1 state", beacon.lastState[1] ?? "-")
                debugRow("Last event", beacon.lastEvent)
            }
            .font(.system(size: 12, design: .monospaced))
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(cardColor)
            .cornerRadius(12)
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(ruleColor, lineWidth: 1))
            .padding(.horizontal)

            // Smoke test: prove the phone sees the puck, live, before trusting
            // the background block flow.
            Button(action: { showSignalTest = true }) {
                HStack {
                    Image(systemName: "dot.radiowaves.left.and.right")
                        .foregroundColor(normalTextColor)
                    Text("Test Beacon Signal")
                        .foregroundColor(normalTextColor)
                }
            }
            .buttonStyle(CardButtonStyle())
            .padding(.horizontal)
        }
        .sheet(isPresented: $showSignalTest) { RangingDebugView() }
        .familyActivityPicker(isPresented: $showAppPicker, selection: $selection)
        .onChange(of: selection) { _, newValue in
            // Persist to the shared selection every surface blocks, and re-apply
            // to any zone currently inside its region so the change takes effect
            // without waiting for a re-entry.
            BlockerModel.selection = newValue
            blockedCount = newValue.applicationTokens.count
                + newValue.categoryTokens.count
                + newValue.webDomainTokens.count
            BeaconManager.shared.syncRegions()
        }
        .onAppear {
            BeaconZone.seedDefaultIfEmpty()
            zones = BeaconZone.all
            selection = BlockerModel.selection
            blockedCount = selection.applicationTokens.count
                + selection.categoryTokens.count
                + selection.webDomainTokens.count
            screenTimeOK = AuthorizationCenter.shared.authorizationStatus == .approved
        }
    }

    private func zoneRow(_ zone: BeaconZone) -> some View {
        HStack(spacing: 15) {
            Text(zone.enabled ? "🛏️" : "💤")
                .font(.system(size: 28))
                .frame(width: 40)

            VStack(alignment: .leading, spacing: 4) {
                Text(zone.name)
                    .font(.headline)
                    .foregroundColor(normalTextColor)
                Text("zone \(zone.major)")
                    .font(.caption)
                    .foregroundColor(normalTextColor.opacity(0.5))
            }

            Spacer()

            Toggle("", isOn: Binding(
                get: { zone.enabled },
                set: { setEnabled(zone, $0) }
            ))
            .labelsHidden()
            .tint(iconColor)
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(cardColor)
        .cornerRadius(12)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(ruleColor, lineWidth: 1))
    }

    private func debugRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundColor(normalTextColor.opacity(0.5))
            Spacer()
            Text(value).foregroundColor(normalTextColor)
        }
    }

    private var locationLabel: String {
        switch auth.status {
        case .authorizedAlways: return "always"
        case .authorizedWhenInUse: return "when-in-use"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "not set"
        @unknown default: return "?"
        }
    }

    private func requestScreenTime() {
        Task {
            try? await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            screenTimeOK = AuthorizationCenter.shared.authorizationStatus == .approved
        }
    }

    private var authHint: String {
        switch auth.status {
        case .notDetermined: return "Beacon blocking needs location to sense the puck."
        case .denied, .restricted: return "Location is off. Enable it in Settings > YawningFace > Location > Always."
        case .authorizedWhenInUse: return "Set to \"Always\" so a zone can block while the app is in your pocket."
        default: return ""
        }
    }

    private func setEnabled(_ zone: BeaconZone, _ on: Bool) {
        Haptics.selection()
        var all = BeaconZone.all
        guard let i = all.firstIndex(where: { $0.major == zone.major }) else { return }
        all[i].enabled = on
        BeaconZone.all = all
        zones = all
        // Register/deregister regions and request Always while we are foreground.
        BeaconManager.shared.resume()
    }
}
