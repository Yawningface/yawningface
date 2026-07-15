import Foundation
import DeviceActivity
import ManagedSettings
import FamilyControls

// The OS-run monitor. It applies and clears shields as intervals begin and end.
// Every decision here goes through Enforcement, which is compiled into this
// target too, so the extension can never drift from the app.

class DeviceActivityMonitorExtension: DeviceActivityMonitor {

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)

        let store = Enforcement.store(forActivityRawValue: activity.rawValue)

        // A scheduled block only shields on the weekdays the user chose. The
        // schedule fires every day at the OS level; the choice is honored here.
        if Enforcement.isScheduled(activity.rawValue),
           !Enforcement.todayIsScheduledDay() {
            store.clearAllSettings()
            return
        }

        guard let selection = Enforcement.loadSelection() else { return }
        Enforcement.applyShield(selection, to: store)
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        // Clear ONLY this interval's store, so ending one block leaves any other
        // active block (an overlapping schedule, or a running session) untouched.
        Enforcement.store(forActivityRawValue: activity.rawValue).clearAllSettings()
    }
}
