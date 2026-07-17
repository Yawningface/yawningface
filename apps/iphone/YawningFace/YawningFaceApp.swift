import SwiftUI

@main
struct YawningFaceApp: App {
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false

    init() {
        if BlockerModel.isEnabled {
            ScheduleManager.startSchedules()
        }
        StreakManager.checkAndUpdateStreak()

        // Re-register beacon regions on launch (including a beacon-triggered
        // background relaunch). resume() no-ops unless a zone is enabled. A
        // MainActor hop because BeaconManager is main-actor isolated.
        Task { @MainActor in BeaconManager.shared.resume() }
    }

    var body: some Scene {
        WindowGroup {
            if hasCompletedOnboarding {
                MainTabView()
            } else {
                OnboardingView(hasCompletedOnboarding: $hasCompletedOnboarding)
            }
        }
    }
}
