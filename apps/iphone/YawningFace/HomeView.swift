import SwiftUI
import FamilyControls
import ManagedSettings
import DeviceActivity

// MARK: - The working session
//
// The home screen is one switch, the same gesture as the tray icon on the
// desktop: press it and the apps go dark. The first time it asks which apps
// and for how long; after that it just starts, and you can still change the
// apps whenever you want.
//
// The blocking itself uses the primitives that already work, and nothing else:
// ManagedSettings applies the shield immediately (so it holds even if this app
// is killed), and a DeviceActivity schedule ends the session on time, in the
// OS-run extension. Schedules registered from the Blocks tab are untouched.

extension DeviceActivityName {
    static let session = DeviceActivityName("workingSession")
}

enum SessionManager {
    private static let store = ManagedSettingsStore()
    private static let center = DeviceActivityCenter()
    private static let group = UserDefaults(suiteName: "group.yawningface.block")

    /// Apple requires at least 15 minutes between a schedule's start and end.
    static let minimumMinutes = 15

    /// End of the running session, or nil when it runs until stopped.
    static var until: Date? {
        get { group?.object(forKey: "sessionUntil") as? Date }
        set { group?.set(newValue, forKey: "sessionUntil") }
    }

    /// How long the running session was asked for, so the app can say it back.
    /// 0 means "until I stop it".
    static var lengthMinutes: Int {
        get { group?.integer(forKey: "sessionMinutes") ?? 0 }
        set { group?.set(newValue, forKey: "sessionMinutes") }
    }

    static var isRunning: Bool {
        get {
            guard group?.bool(forKey: "sessionActive") == true else { return false }
            if let end = until, end <= Date() {
                // It expired while we were away; make the state honest.
                stop()
                return false
            }
            return true
        }
    }

    /// `minutes == nil` means "until I stop it".
    static func start(minutes: Int?) {
        let selection = BlockerModel.selection
        guard !selection.applicationTokens.isEmpty else { return }

        // Immediate: the shield is a system setting, so it survives a force-quit.
        store.shield.applications = selection.applicationTokens

        group?.set(true, forKey: "sessionActive")
        lengthMinutes = minutes ?? 0
        History.begin(
            plannedMinutes: minutes ?? 0,
            appCount: selection.applicationTokens.count
        )

        if let minutes, minutes >= minimumMinutes {
            let end = Date().addingTimeInterval(TimeInterval(minutes * 60))
            until = end

            // The extension clears the shield at intervalDidEnd. A one-shot
            // schedule from now to the end time is all this needs.
            let cal = Calendar.current
            let schedule = DeviceActivitySchedule(
                intervalStart: cal.dateComponents([.hour, .minute], from: Date()),
                intervalEnd: cal.dateComponents([.hour, .minute], from: end),
                repeats: false
            )
            try? center.startMonitoring(.session, during: schedule)
        } else {
            until = nil
        }
    }

    /// `unblocked` is true only when the session was cut short from the shield.
    /// Ending it from the app after it has done its job is not a cave-in.
    static func stop(unblocked: Bool = false) {
        store.shield.applications = nil
        center.stopMonitoring([.session])
        group?.set(false, forKey: "sessionActive")
        group?.removeObject(forKey: "sessionUntil")
        group?.removeObject(forKey: "sessionMinutes")
        History.end(unblocked: unblocked)
    }
}

// MARK: - Home

struct HomeView: View {
    @Binding var isAuthorized: Bool

    @State private var minutes: Int? = 60
    @State private var running = false
    @State private var until: Date?
    @State private var appCount = 0
    @State private var showPicker = false
    /// True when the picker was opened by pressing Start with nothing chosen:
    /// the session begins as soon as apps are picked.
    @State private var startAfterPicking = false
    @State private var selection = FamilyActivitySelection()

    private let durations: [(String, Int?)] = [
        ("30 min", 30), ("1 h", 60), ("2 h", 120), ("No limit", nil),
    ]

    var body: some View {
        VStack(spacing: 22) {
            if !isAuthorized {
                permissionRow
            }

            Spacer()

            Text(running ? "😎" : "😴")
                .font(.system(size: 92))

            VStack(spacing: 6) {
                Text(stateLine)
                    .font(.title3)
                    .fontWeight(.semibold)
                    .foregroundColor(normalTextColor)
                    .multilineTextAlignment(.center)

                if let sessionSubline {
                    Text(sessionSubline)
                        .font(.subheadline)
                        .foregroundColor(normalTextColor.opacity(0.55))
                }
            }
            .padding(.horizontal, 32)

            Spacer()

            if running {
                Button("End session") { end() }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.horizontal, 28)
            } else {
                durationPicker
                    .padding(.horizontal, 28)

                Button("Start working session") { start() }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.horizontal, 28)

                Button(appCount == 0 ? "Pick your distracting apps" : "\(appCount) apps · change") {
                    startAfterPicking = false
                    showPicker = true
                }
                .font(.subheadline)
                .foregroundColor(normalTextColor.opacity(0.55))
            }
        }
        .padding(.bottom, 28)
        .background(backgroundColor.ignoresSafeArea())
        .onAppear(perform: refresh)
        .familyActivityPicker(isPresented: $showPicker, selection: $selection)
        .onChange(of: showPicker) { _, isShowing in
            guard !isShowing else { return }
            BlockerModel.selection = selection
            refresh()
            if startAfterPicking, appCount > 0 {
                startAfterPicking = false
                SessionManager.start(minutes: minutes)
                Haptics.success()
                refresh()
            }
        }
    }

    private var permissionRow: some View {
        HStack {
            Text("Blocking needs Screen Time permission.")
                .font(.subheadline)
                .foregroundColor(normalTextColor)
            Spacer()
            Button("Allow") { requestAuth() }
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(normalTextColor)
                .foregroundColor(iconColor)
                .cornerRadius(20)
        }
        .padding(14)
        .background(iconColor)
        .cornerRadius(10)
        .padding(.horizontal, 20)
        .padding(.top, 8)
    }

    /// The same segmented control as the desktop app.
    private var durationPicker: some View {
        HStack(spacing: 0) {
            ForEach(durations, id: \.0) { label, value in
                Button {
                    minutes = value
                    Haptics.selection()
                } label: {
                    Text(label)
                        .font(.footnote.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .background(minutes == value ? iconColor : Color.clear)
                        .foregroundColor(minutes == value ? normalTextColor : normalTextColor.opacity(0.5))
                        .cornerRadius(6)
                }
            }
        }
        .padding(3)
        .background(cardColor)
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(ruleColor, lineWidth: 1))
        .cornerRadius(9)
    }

    private var appsPhrase: String {
        appCount == 1 ? "1 app" : "\(appCount) apps"
    }

    /// The headline says what is true; the line under it says what you asked
    /// for, so a session you started an hour ago still explains itself.
    private var stateLine: String {
        guard running else {
            return appCount == 0 ? "Ready to focus?" : "Nothing blocked right now."
        }
        if let until {
            let f = DateFormatter()
            f.timeStyle = .short
            return "Blocking \(appsPhrase) until \(f.string(from: until))"
        }
        return "Blocking \(appsPhrase) until you stop"
    }

    private var sessionSubline: String? {
        guard running else { return nil }
        let length = SessionManager.lengthMinutes
        guard length > 0 else { return "No limit - it stops when you say so." }
        return length % 60 == 0
            ? "\(length / 60) h session"
            : "\(length) min session"
    }

    private func start() {
        guard isAuthorized else { requestAuth(); return }
        if appCount == 0 {
            // First run: ask for the apps, then start straight away.
            startAfterPicking = true
            showPicker = true
            return
        }
        SessionManager.start(minutes: minutes)
        Haptics.success()
        refresh()
    }

    private func end() {
        SessionManager.stop()
        Haptics.medium()
        refresh()
    }

    private func refresh() {
        selection = BlockerModel.selection
        appCount = selection.applicationTokens.count
        running = SessionManager.isRunning
        until = SessionManager.until
    }

    private func requestAuth() {
        Task {
            try? await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            await MainActor.run {
                let approved = AuthorizationCenter.shared.authorizationStatus == .approved
                isAuthorized = approved
                UserDefaults.standard.set(approved, forKey: "authorized")
            }
        }
    }
}

#Preview { HomeView(isAuthorized: .constant(true)) }
