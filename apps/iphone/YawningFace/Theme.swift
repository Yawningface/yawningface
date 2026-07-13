import SwiftUI
import UIKit

// MARK: - Colors
//
// One palette across the whole ecosystem: the website, the desktop app, the
// Chrome extension and this. Paper, ink, one yellow. Changing these four
// values is the only thing needed to keep the phone in step.

/// White sheets on paper, with a hairline. Same as the desktop app's cards.
let cardColor = Color(hex: "#FFFFFF")
let backgroundColor = Color(hex: "#FAF9F4")
let iconColor = Color(hex: "#F0DB0C")
let normalTextColor = Color(hex: "#12120F")

/// Hairline rule, for card borders on paper.
let ruleColor = Color(hex: "#12120F").opacity(0.14)

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r, g, b: UInt64
        switch hex.count {
        case 6: (r, g, b) = (int >> 16, int >> 8 & 0xFF, int & 0xFF)
        default: (r, g, b) = (0, 0, 0)
        }
        self.init(.sRGB, red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255)
    }
}

// MARK: - Button Styles

/// Ink button, yellow label: the same primary the desktop app and the
/// extension use.
struct PrimaryButtonStyle: ButtonStyle {
    var enabled: Bool = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .fontWeight(.semibold)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(enabled ? normalTextColor : cardColor)
            .foregroundColor(enabled ? iconColor : normalTextColor.opacity(0.4))
            .cornerRadius(25)
            .overlay(
                RoundedRectangle(cornerRadius: 25)
                    .stroke(enabled ? Color.clear : ruleColor, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

struct CardButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(12)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(cardColor)
            .foregroundColor(normalTextColor)
            .cornerRadius(8)
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(ruleColor, lineWidth: 1))
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

// MARK: - Empty State View

struct EmptyStateView: View {
    let icon: String
    let title: String
    let message: String
    var buttonTitle: String? = nil
    var buttonAction: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 16) {
            Text(icon)
                .font(.system(size: 60))

            VStack(spacing: 8) {
                Text(title)
                    .font(.headline)
                    .foregroundColor(normalTextColor)

                Text(message)
                    .font(.subheadline)
                    .foregroundColor(normalTextColor.opacity(0.6))
                    .multilineTextAlignment(.center)
            }

            if let buttonTitle = buttonTitle, let action = buttonAction {
                Button(action: action) {
                    Text(buttonTitle)
                        .font(.subheadline)
                        .foregroundColor(.black)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 12)
                        .background(iconColor)
                        .cornerRadius(20)
                }
                .padding(.top, 8)
            }
        }
        .padding(40)
    }
}

// MARK: - Haptic Feedback

struct Haptics {
    static func light() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    static func medium() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    static func selection() {
        UISelectionFeedbackGenerator().selectionChanged()
    }
}
