import Foundation
import FamilyControls
import ManagedSettings

// Shared enforcement primitives, compiled into the app AND both shield-related
// extensions (see add-enforcement-file.rb). One definition of the stores, the
// weekday rule, and what "apply the shield" means, so the app, the monitor
// extension and the shield action can never disagree.

// MARK: - Named stores, one per concern
//
// The whole point of separate names: iOS applies the UNION of every store's
// restrictions, and clearing one store leaves the others intact. So ending a
// scheduled interval can no longer wipe a running working session (and vice
// versa), and two overlapping schedules no longer unblock each other.

extension ManagedSettingsStore.Name {
    /// The one-tap working session.
    static let session = ManagedSettingsStore.Name("yfSession")
    /// A scheduled block. One store per period index so overlaps are independent.
    static func schedule(_ index: Int) -> ManagedSettingsStore.Name {
        ManagedSettingsStore.Name("yfSchedule\(index)")
    }
}

enum Enforcement {
    static let group = UserDefaults(suiteName: "group.yawningface.block")

    // MARK: - Selection

    /// The selection every surface blocks. Kept in the app group as a plist,
    /// exactly as the picker encodes it.
    static func loadSelection() -> FamilyActivitySelection? {
        guard let data = group?.data(forKey: "selection"),
              let selection = try? PropertyListDecoder()
                .decode(FamilyActivitySelection.self, from: data)
        else { return nil }
        return selection
    }

    /// True if anything at all is selected - apps, categories, or websites.
    /// Onboarding and Start both use this, so a category-only pick is no longer
    /// treated as "nothing selected".
    static func hasAnyTarget(_ selection: FamilyActivitySelection) -> Bool {
        !(selection.applicationTokens.isEmpty
            && selection.categoryTokens.isEmpty
            && selection.webDomainTokens.isEmpty)
    }

    // MARK: - Applying the shield
    //
    // Shields ALL three token types the picker can yield. Before this, only
    // applicationTokens were shielded, so a category-only or website-only
    // selection blocked nothing while claiming to be active.

    static func applyShield(_ selection: FamilyActivitySelection,
                            to store: ManagedSettingsStore) {
        store.shield.applications =
            selection.applicationTokens.isEmpty ? nil : selection.applicationTokens

        store.shield.applicationCategories =
            selection.categoryTokens.isEmpty ? nil : .specific(selection.categoryTokens)

        store.shield.webDomains =
            selection.webDomainTokens.isEmpty ? nil : selection.webDomainTokens

        store.shield.webDomainCategories =
            selection.categoryTokens.isEmpty ? nil : .specific(selection.categoryTokens)
    }

    // MARK: - Weekdays
    //
    // Schedules repeat every day at the OS level; whether today is a chosen day
    // is decided here, when the interval starts. Apple weekday numbering is
    // 1 = Sunday ... 7 = Saturday, matching what the day picker stores.

    static var selectedWeekdays: [Int] {
        group?.array(forKey: "days") as? [Int] ?? [2, 3, 4, 5, 6] // Mon-Fri
    }

    static func todayIsScheduledDay(on date: Date = Date()) -> Bool {
        let days = selectedWeekdays
        if days.isEmpty { return true } // empty set = every day
        return days.contains(Calendar.current.component(.weekday, from: date))
    }

    // MARK: - Activity -> store mapping

    static let sessionActivityRawValue = "workingSession"

    static func isScheduled(_ activity: DeviceActivityRawName) -> Bool {
        activity.hasPrefix("period")
    }

    /// Maps a DeviceActivity name to the store it owns. `period{i}_{a|b}` ->
    /// `schedule(i)`; the working session -> `.session`.
    static func store(forActivityRawValue raw: DeviceActivityRawName) -> ManagedSettingsStore {
        if raw == sessionActivityRawValue {
            return ManagedSettingsStore(named: .session)
        }
        if raw.hasPrefix("period") {
            let digits = raw.dropFirst("period".count).prefix { $0.isNumber }
            if let index = Int(digits) {
                return ManagedSettingsStore(named: .schedule(index))
            }
        }
        return ManagedSettingsStore(named: .session)
    }
}

/// A DeviceActivityName's raw string. Declared here so this file needs no
/// `import DeviceActivity` (the app group is the only shared surface the
/// extensions and the app all link).
typealias DeviceActivityRawName = String
