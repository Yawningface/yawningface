import ManagedSettings
import ManagedSettingsUI
import UIKit

/// The screen you meet when you reach for a blocked app. It is the only part of
/// the product most users will see every day, so it does the same job as the
/// browser extension's blocked page: say what is true, say why, and let you out
/// if you really mean it - while quietly counting that you did.

class ShieldConfigurationExtension: ShieldConfigurationDataSource {

    private let group = UserDefaults(suiteName: "group.yawningface.block")

    // The palette, shared with the app, the desktop and the site.
    private let paper = UIColor(red: 0.98, green: 0.976, blue: 0.957, alpha: 1)
    private let ink = UIColor(red: 0.07, green: 0.07, blue: 0.059, alpha: 1)
    private let yellow = UIColor(red: 0.941, green: 0.859, blue: 0.047, alpha: 1)

    private var strictMode: Bool { group?.bool(forKey: "strictMode") ?? false }

    private func configuration() -> ShieldConfiguration {
        // In Strict Mode there is deliberately no way out, so the "Unblock
        // anyway" button is not even offered (the action extension refuses it
        // too, belt and braces).
        let secondary = strictMode
            ? nil
            : ShieldConfiguration.Label(
                text: "Unblock anyway",
                color: ink.withAlphaComponent(0.55)
            )

        return ShieldConfiguration(
            backgroundBlurStyle: .systemUltraThinMaterialLight,
            backgroundColor: paper,
            icon: UIImage(named: "ShieldIcon"),
            title: ShieldConfiguration.Label(
                text: "You asked me to stop you.",
                color: ink
            ),
            subtitle: ShieldConfiguration.Label(text: subtitle(), color: ink.withAlphaComponent(0.7)),
            primaryButtonLabel: ShieldConfiguration.Label(text: "Keep me out", color: yellow),
            primaryButtonBackgroundColor: ink,
            secondaryButtonLabel: secondary
        )
    }

    /// Honest, not preachy: how long is left, and how often you have caved today.
    private func subtitle() -> String {
        var lines: [String] = []

        if let until = group?.object(forKey: "sessionUntil") as? Date, until > Date() {
            let f = DateFormatter()
            f.timeStyle = .short
            lines.append("Your session runs until \(f.string(from: until)).")
        } else {
            lines.append("Your session is running.")
        }

        let unblocks = unblocksToday()
        if unblocks == 1 {
            lines.append("You have unblocked once today.")
        } else if unblocks > 1 {
            lines.append("You have unblocked \(unblocks) times today.")
        } else {
            lines.append("It will still be here later.")
        }

        return lines.joined(separator: " ")
    }

    /// Reads the same history the app writes, without importing the app target.
    private func unblocksToday() -> Int {
        guard let data = group?.data(forKey: "history"),
              let list = try? JSONDecoder().decode([Record].self, from: data)
        else { return 0 }
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        let today = f.string(from: Date())
        return list.filter { $0.unblocked && f.string(from: $0.start) == today }.count
    }

    /// Mirror of SessionRecord, decoded structurally.
    private struct Record: Codable {
        var start: Date
        var end: Date?
        var unblocked: Bool
    }

    override func configuration(shielding application: Application) -> ShieldConfiguration {
        configuration()
    }

    override func configuration(
        shielding application: Application,
        in category: ActivityCategory
    ) -> ShieldConfiguration {
        configuration()
    }

    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
        configuration()
    }

    override func configuration(
        shielding webDomain: WebDomain,
        in category: ActivityCategory
    ) -> ShieldConfiguration {
        configuration()
    }
}
