import SwiftUI
import FamilyControls

struct MainTabView: View {
    @State private var isAuthorized = false

    var body: some View {
        TabView {
            HomeView(isAuthorized: $isAuthorized)
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }

            InsightsView()
                .tabItem {
                    Label("Insights", systemImage: "chart.bar.fill")
                }

            BlocksView(isAuthorized: $isAuthorized)
                .tabItem {
                    Label("Blocks", systemImage: "lock.shield.fill")
                }

            ProfileView()
                .tabItem {
                    Label("Profile", systemImage: "person.fill")
                }
        }
        .accentColor(iconColor)
        .onAppear { checkAuthorization() }
    }

    private func checkAuthorization() {
        // Trust only the live system status. OR-ing a cached "authorized" flag
        // meant the app kept claiming permission after the user revoked Screen
        // Time access in Settings, hiding the banner while blocking silently
        // did nothing.
        let approved = AuthorizationCenter.shared.authorizationStatus == .approved
        isAuthorized = approved
        UserDefaults.standard.set(approved, forKey: "authorized")
    }
}

#Preview { MainTabView() }
