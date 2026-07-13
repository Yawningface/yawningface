import SwiftUI
import FamilyControls

/// Task-flow onboarding: progress bar, permission with a dialog preview,
/// then pick the first apps so the user leaves with something blocked.
/// Buttons advance the flow; there is no free swiping.
struct OnboardingView: View {
    @Binding var hasCompletedOnboarding: Bool
    @State private var step = 0

    private let totalSteps = 4

    var body: some View {
        ZStack {
            backgroundColor.ignoresSafeArea()

            VStack(spacing: 0) {
                OnboardingProgressBar(progress: Double(step + 1) / Double(totalSteps))
                    .padding(.horizontal, 60)
                    .padding(.top, 24)

                Group {
                    switch step {
                    case 0:
                        WelcomeStep(onContinue: advance)
                    case 1:
                        AllowScreenTimeStep(onContinue: advance)
                    case 2:
                        PickAppsStep(onContinue: advance)
                    default:
                        ReadyStep(onComplete: { hasCompletedOnboarding = true })
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity),
                                        removal: .move(edge: .leading).combined(with: .opacity)))
                .id(step)
            }
            .animation(.easeInOut(duration: 0.3), value: step)
        }
    }

    private func advance() {
        withAnimation { step += 1 }
    }
}

struct OnboardingProgressBar: View {
    let progress: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(cardColor)
                Capsule()
                    .fill(iconColor)
                    .frame(width: geo.size.width * progress)
                    .animation(.easeInOut(duration: 0.3), value: progress)
            }
        }
        .frame(height: 6)
    }
}

// MARK: - Step 1: Welcome

private struct WelcomeStep: View {
    let onContinue: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Text("😴")
                .font(.system(size: 80))

            VStack(spacing: 12) {
                Text("yawningface")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundColor(normalTextColor)

                Text("The apps that eat your day, gone.")
                    .font(.title3)
                    .foregroundColor(normalTextColor.opacity(0.7))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }

            Text("Two minutes of setup. No account, nothing leaves your phone.")
                .font(.subheadline)
                .foregroundColor(normalTextColor.opacity(0.5))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)

            Spacer()

            Button("Get started", action: onContinue)
                .buttonStyle(PrimaryButtonStyle())
                .padding(.horizontal, 40)
                .padding(.bottom, 40)
        }
    }
}

// MARK: - Step 2: Screen Time permission, with a preview of Apple's dialog

private struct AllowScreenTimeStep: View {
    let onContinue: () -> Void

    @State private var isRequesting = false
    @State private var denied = false
    @State private var alreadyApproved = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            VStack(spacing: 12) {
                Text("First, allow Screen Time")
                    .font(.title)
                    .fontWeight(.bold)
                    .foregroundColor(normalTextColor)
                    .multilineTextAlignment(.center)

                Text("Blocking apps is an iOS permission. You will see this dialog: tap Continue on it.")
                    .font(.body)
                    .foregroundColor(normalTextColor.opacity(0.7))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }

            // Preview of the real iOS sheet, so the real one is expected
            // rather than alarming. The arrow marks the button to tap.
            VStack(spacing: 0) {
                VStack(spacing: 8) {
                    Text("\u{201C}yawningface\u{201D} Would Like to Access Screen Time")
                        .font(.headline)
                        .foregroundColor(normalTextColor)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Text("Providing \u{201C}yawningface\u{201D} access to Screen Time may allow it to see your activity data, restrict content, and limit the usage of apps and websites.")
                        .font(.subheadline)
                        .foregroundColor(normalTextColor.opacity(0.6))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(20)

                HStack(spacing: 12) {
                    Text("Continue")
                        .font(.headline)
                        .foregroundColor(normalTextColor)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(Color.white.opacity(0.12))
                        .cornerRadius(22)
                    Text("Don't Allow")
                        .font(.body)
                        .foregroundColor(normalTextColor.opacity(0.6))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(Color.white.opacity(0.05))
                        .cornerRadius(22)
                }
                .padding([.horizontal, .bottom], 16)
            }
            .background(cardColor)
            .cornerRadius(20)
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(iconColor, lineWidth: 2))
            .padding(.horizontal, 32)

            HStack {
                Image(systemName: "arrow.up")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(iconColor)
                    .frame(maxWidth: .infinity)
                Spacer()
                    .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, 48)

            if denied {
                Text("iOS said no. Try again, or allow it later from Settings.")
                    .font(.subheadline)
                    .foregroundColor(normalTextColor.opacity(0.7))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }

            Spacer()

            VStack(spacing: 12) {
                Button {
                    requestAuthorization()
                } label: {
                    if isRequesting {
                        ProgressView().progressViewStyle(CircularProgressViewStyle(tint: .black))
                    } else {
                        Text(alreadyApproved ? "Screen Time allowed ✓" : (denied ? "Try again" : "Allow Screen Time"))
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(isRequesting)

                Button("Skip for now") { onContinue() }
                    .font(.subheadline)
                    .foregroundColor(normalTextColor.opacity(0.5))
            }
            .padding(.horizontal, 40)
            .padding(.bottom, 24)

            Text("Your data stays on this iPhone. Apple's design means we never see what you do.")
                .font(.caption)
                .foregroundColor(normalTextColor.opacity(0.4))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
                .padding(.bottom, 24)
        }
        .onAppear {
            if AuthorizationCenter.shared.authorizationStatus == .approved {
                alreadyApproved = true
            }
        }
    }

    private func requestAuthorization() {
        if alreadyApproved {
            onContinue()
            return
        }
        isRequesting = true
        Task {
            do {
                try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
                await MainActor.run {
                    let approved = AuthorizationCenter.shared.authorizationStatus == .approved
                    UserDefaults.standard.set(approved, forKey: "authorized")
                    isRequesting = false
                    if approved {
                        Haptics.success()
                        onContinue()
                    } else {
                        denied = true
                    }
                }
            } catch {
                await MainActor.run {
                    isRequesting = false
                    denied = true
                }
            }
        }
    }
}

// MARK: - Step 3: pick the first apps

private struct PickAppsStep: View {
    let onContinue: () -> Void

    @State private var selection = BlockerModel.selection

    private var selectedCount: Int {
        selection.applicationTokens.count
            + selection.categoryTokens.count
            + selection.webDomainTokens.count
    }

    var body: some View {
        VStack(spacing: 16) {
            VStack(spacing: 12) {
                Text("Start with your most distracting apps")
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(normalTextColor)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)

                Text("Pick the ones that pull you in. You can change this anytime.")
                    .font(.subheadline)
                    .foregroundColor(normalTextColor.opacity(0.6))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
            }
            .padding(.top, 24)

            FamilyActivityPicker(selection: $selection)
                .background(cardColor)
                .cornerRadius(16)
                .padding(.horizontal, 16)

            VStack(spacing: 12) {
                Button(selectedCount == 0 ? "Pick at least one" : "Block \(selectedCount) selected") {
                    BlockerModel.selection = selection
                    Haptics.success()
                    onContinue()
                }
                .buttonStyle(PrimaryButtonStyle(enabled: selectedCount > 0))
                .disabled(selectedCount == 0)

                Button("Skip for now") { onContinue() }
                    .font(.subheadline)
                    .foregroundColor(normalTextColor.opacity(0.5))
            }
            .padding(.horizontal, 40)
            .padding(.bottom, 40)
        }
    }
}

// MARK: - Step 4: done, with the option to arm the default schedule

private struct ReadyStep: View {
    let onComplete: () -> Void

    private var hasSelection: Bool {
        let s = BlockerModel.selection
        return !(s.applicationTokens.isEmpty && s.categoryTokens.isEmpty && s.webDomainTokens.isEmpty)
    }

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            Text("😎")
                .font(.system(size: 80))

            VStack(spacing: 12) {
                Text("That's the setup")
                    .font(.title)
                    .fontWeight(.bold)
                    .foregroundColor(normalTextColor)

                if hasSelection {
                    Text("Turn on the starter schedule (every weekday, 9 pm to 9 am) or set your own from the app.")
                        .font(.body)
                        .foregroundColor(normalTextColor.opacity(0.7))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                } else {
                    Text("Pick apps and a schedule whenever you're ready.")
                        .font(.body)
                        .foregroundColor(normalTextColor.opacity(0.7))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                }
            }

            Spacer()

            VStack(spacing: 12) {
                if hasSelection {
                    Button("Start blocking") {
                        BlockerModel.isEnabled = true
                        ScheduleManager.startSchedules()
                        Haptics.success()
                        onComplete()
                    }
                    .buttonStyle(PrimaryButtonStyle())

                    Button("I'll set my own schedule") { onComplete() }
                        .font(.subheadline)
                        .foregroundColor(normalTextColor.opacity(0.5))
                } else {
                    Button("Open yawningface", action: onComplete)
                        .buttonStyle(PrimaryButtonStyle())
                }
            }
            .padding(.horizontal, 40)
            .padding(.bottom, 50)
        }
    }
}

#Preview {
    OnboardingView(hasCompletedOnboarding: .constant(false))
}
