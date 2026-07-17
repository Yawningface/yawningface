import SwiftUI
import Combine
import CoreLocation

// Live distance to the puck. This is the smoke test for "does the phone see the
// beacon at all", and doubles as the bones of a pairing screen ("move closer").
//
// It uses RANGING (continuous RSSI -> accuracy in meters), not CLMonitor. Ranging
// is foreground-only and needs only when-in-use location, which makes it the
// fastest way to prove detection without the background-session machinery. The
// meter reading is an RSSI inference, not geometry: treat it as relative, not a
// tape measure. See product/documentation/beacon.md section 6.

@MainActor
final class BeaconRanger: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var accuracy: CLLocationAccuracy = -1   // meters; <0 means no reading
    @Published var rssi: Int = 0
    @Published var proximity: CLProximity = .unknown
    @Published var major: Int? = nil
    @Published var minor: Int? = nil
    @Published var authorized = false

    private let manager = CLLocationManager()
    private let constraint = CLBeaconIdentityConstraint(uuid: BeaconManager.fleetUUID)

    override init() {
        super.init()
        manager.delegate = self
    }

    func start() {
        manager.requestWhenInUseAuthorization()
        applyAuth(manager.authorizationStatus)
    }

    func stop() {
        manager.stopRangingBeacons(satisfying: constraint)
    }

    private func applyAuth(_ status: CLAuthorizationStatus) {
        authorized = status == .authorizedWhenInUse || status == .authorizedAlways
        if authorized {
            manager.startRangingBeacons(satisfying: constraint)
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        Task { @MainActor in self.applyAuth(m.authorizationStatus) }
    }

    nonisolated func locationManager(_ m: CLLocationManager,
                                     didRange beacons: [CLBeacon],
                                     satisfying c: CLBeaconIdentityConstraint) {
        // Nearest first, so a stack of pucks reads as the one you are closest to.
        let nearest = beacons
            .filter { $0.accuracy >= 0 }
            .min(by: { $0.accuracy < $1.accuracy }) ?? beacons.first
        Task { @MainActor in
            guard let b = nearest else {
                self.accuracy = -1
                return
            }
            self.accuracy = b.accuracy
            self.rssi = b.rssi
            self.proximity = b.proximity
            self.major = b.major.intValue
            self.minor = b.minor.intValue
        }
    }
}

struct RangingDebugView: View {
    @StateObject private var ranger = BeaconRanger()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 24) {
            Text("Beacon Signal")
                .font(.title2).fontWeight(.bold)
                .foregroundColor(normalTextColor)
                .padding(.top, 30)

            Spacer()

            if !ranger.authorized {
                Text("📡").font(.system(size: 60))
                Text("Location permission needed to sense the puck.")
                    .font(.subheadline)
                    .foregroundColor(normalTextColor.opacity(0.6))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            } else if ranger.accuracy < 0 {
                ProgressView().scaleEffect(1.4)
                Text("Searching for the puck…")
                    .font(.subheadline)
                    .foregroundColor(normalTextColor.opacity(0.6))
                Text("Make sure it is powered and advertising.")
                    .font(.caption)
                    .foregroundColor(normalTextColor.opacity(0.4))
            } else {
                Text(proximityEmoji).font(.system(size: 64))

                Text(String(format: "%.1f m", ranger.accuracy))
                    .font(.system(size: 56, weight: .bold, design: .rounded))
                    .foregroundColor(normalTextColor)

                Text(proximityLabel.uppercased())
                    .font(.headline)
                    .foregroundColor(iconColor == .clear ? normalTextColor : normalTextColor)
                    .padding(.horizontal, 16).padding(.vertical, 6)
                    .background(iconColor.opacity(0.25))
                    .cornerRadius(8)

                VStack(spacing: 6) {
                    row("RSSI", "\(ranger.rssi) dBm")
                    row("Zone (major)", ranger.major.map(String.init) ?? "-")
                    row("Puck (minor)", ranger.minor.map(String.init) ?? "-")
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(cardColor)
                .cornerRadius(12)
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(ruleColor, lineWidth: 1))
                .padding(.horizontal, 30)

                Text("Distance is inferred from signal strength, so it drifts near metal and mirrors. Read it as closer / further, not a tape measure.")
                    .font(.caption2)
                    .foregroundColor(normalTextColor.opacity(0.45))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }

            Spacer()

            Button("Done") { dismiss() }
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal, 30)
                .padding(.bottom, 30)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(backgroundColor.ignoresSafeArea())
        .onAppear { ranger.start() }
        .onDisappear { ranger.stop() }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundColor(normalTextColor.opacity(0.6))
            Spacer()
            Text(value).fontWeight(.medium).foregroundColor(normalTextColor)
        }
        .font(.subheadline)
    }

    private var proximityLabel: String {
        switch ranger.proximity {
        case .immediate: return "Immediate"
        case .near: return "Near"
        case .far: return "Far"
        default: return "Unknown"
        }
    }

    private var proximityEmoji: String {
        switch ranger.proximity {
        case .immediate: return "🎯"
        case .near: return "📍"
        case .far: return "📶"
        default: return "❓"
        }
    }
}
