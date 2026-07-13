import ManagedSettings
import DeviceActivity
import Foundation

/// What the buttons on the shield actually do.
///
/// "Keep me out" simply closes the app: the block holds.
/// "Unblock anyway" lifts the shield and ends the session - and writes it down.
/// The counting is the point: an escape hatch you never see the cost of is how
/// a blocker quietly becomes decoration.

class ShieldActionExtension: ShieldActionDelegate {

    private let store = ManagedSettingsStore()
    private let center = DeviceActivityCenter()
    private let group = UserDefaults(suiteName: "group.yawningface.block")

    private func handle(_ action: ShieldAction, completionHandler: @escaping (ShieldActionResponse) -> Void) {
        switch action {
        case .primaryButtonPressed:
            // "Keep me out": the shield stays exactly as it is.
            completionHandler(.close)

        case .secondaryButtonPressed:
            unblock()
            completionHandler(.none)

        @unknown default:
            completionHandler(.close)
        }
    }

    private func unblock() {
        store.shield.applications = nil
        center.stopMonitoring([DeviceActivityName("workingSession")])

        group?.set(false, forKey: "sessionActive")
        group?.removeObject(forKey: "sessionUntil")
        group?.removeObject(forKey: "sessionMinutes")

        recordUnblock()
    }

    /// Closes the open session in the shared history and marks it unblocked.
    /// Structural mirror of the app's SessionRecord: the extension cannot see
    /// the app's types, but it can speak the same JSON.
    private func recordUnblock() {
        guard let data = group?.data(forKey: "history"),
              var list = try? JSONDecoder().decode([Record].self, from: data)
        else { return }

        if let i = list.lastIndex(where: { $0.end == nil }) {
            list[i].end = Date()
            list[i].unblocked = true
        }
        if let encoded = try? JSONEncoder().encode(list) {
            group?.set(encoded, forKey: "history")
        }
    }

    private struct Record: Codable {
        var id: UUID
        var start: Date
        var end: Date?
        var plannedMinutes: Int
        var unblocked: Bool
        var appCount: Int
    }

    override func handle(
        action: ShieldAction,
        for application: ApplicationToken,
        completionHandler: @escaping (ShieldActionResponse) -> Void
    ) {
        handle(action, completionHandler: completionHandler)
    }

    override func handle(
        action: ShieldAction,
        for webDomain: WebDomainToken,
        completionHandler: @escaping (ShieldActionResponse) -> Void
    ) {
        handle(action, completionHandler: completionHandler)
    }

    override func handle(
        action: ShieldAction,
        for category: ActivityCategoryToken,
        completionHandler: @escaping (ShieldActionResponse) -> Void
    ) {
        handle(action, completionHandler: completionHandler)
    }
}
