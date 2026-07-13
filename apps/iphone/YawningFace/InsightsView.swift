import SwiftUI

/// The same page as the desktop app's Insights, on the phone: focused time,
/// a streak with a heatmap, and the unblocks. Everything is measured, nothing
/// is estimated, and it never leaves the device.

struct InsightsView: View {
    @State private var focusByDay: [String: Int] = [:]
    @State private var streak = 0
    @State private var longest = 0
    @State private var unblocksTotal = 0
    @State private var unblocksToday = 0
    @State private var sessions = 0

    private let cal = Calendar.current

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Insights")
                        .font(.title2.weight(.semibold))
                    Text("Measured on this phone. Nothing is uploaded, and nothing here is a guess.")
                        .font(.footnote)
                        .foregroundColor(normalTextColor.opacity(0.6))
                }
                .padding(.bottom, 2)

                if totalMinutes == 0 && sessions == 0 {
                    emptyState
                } else {
                    todayCard
                    activityCard
                    streakCard
                    unblockCard
                    allTimeCard
                }
            }
            .padding(20)
        }
        .background(backgroundColor.ignoresSafeArea())
        .onAppear(perform: load)
    }

    // MARK: - Cards

    private var emptyState: some View {
        VStack(spacing: 10) {
            Text("😴").font(.system(size: 46))
            Text("Nothing to show yet")
                .font(.headline)
            Text("Start a working session and this fills up: hours focused, streaks, and every time you unblocked.")
                .font(.subheadline)
                .foregroundColor(normalTextColor.opacity(0.6))
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 44)
        .background(cardColor)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(ruleColor, lineWidth: 1))
        .cornerRadius(12)
    }

    private var todayCard: some View {
        card {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(human(minutesOn(Date())))
                        .font(.system(size: 30, weight: .semibold))
                        .monospacedDigit()
                    Text("focused today")
                        .font(.footnote)
                        .foregroundColor(normalTextColor.opacity(0.55))
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(human(lastSevenDays))
                        .font(.headline)
                        .monospacedDigit()
                    Text("last 7 days")
                        .font(.footnote)
                        .foregroundColor(normalTextColor.opacity(0.55))
                }
            }
        }
    }

    private var activityCard: some View {
        card {
            VStack(alignment: .leading, spacing: 10) {
                header("Activity", trailing: "last 14 days")
                let days = lastDays(14)
                let peak = max(1, days.map { minutesOn($0) }.max() ?? 1)
                HStack(alignment: .bottom, spacing: 5) {
                    ForEach(days, id: \.self) { day in
                        let m = minutesOn(day)
                        VStack(spacing: 4) {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(m > 0 ? iconColor : ruleColor)
                                .frame(height: max(m > 0 ? 6 : 3, CGFloat(m) / CGFloat(peak) * 90))
                            Text("\(cal.component(.day, from: day))")
                                .font(.system(size: 8))
                                .foregroundColor(normalTextColor.opacity(0.4))
                        }
                    }
                }
                .frame(height: 110, alignment: .bottom)
            }
        }
    }

    private var streakCard: some View {
        card {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(streak)")
                        .font(.system(size: 26, weight: .semibold))
                        .monospacedDigit()
                    Text("day streak")
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(normalTextColor.opacity(0.7))
                    Spacer()
                    Text("longest \(longest) days")
                        .font(.footnote)
                        .foregroundColor(normalTextColor.opacity(0.5))
                }
                heatmap
            }
        }
    }

    /// Ten weeks of squares, the way the desktop shows them.
    private var heatmap: some View {
        let weeks = 10
        let peak = max(1, focusByDay.values.map { $0 / 60 }.max() ?? 1)
        let today = cal.startOfDay(for: Date())
        let weekdayOffset = (cal.component(.weekday, from: today) + 5) % 7 // Monday = 0
        let gridStart = cal.date(byAdding: .day, value: -(weekdayOffset + (weeks - 1) * 7), to: today)!

        return HStack(spacing: 3) {
            ForEach(0..<weeks, id: \.self) { w in
                VStack(spacing: 3) {
                    ForEach(0..<7, id: \.self) { d in
                        let day = cal.date(byAdding: .day, value: w * 7 + d, to: gridStart)!
                        let m = minutesOn(day)
                        RoundedRectangle(cornerRadius: 2)
                            .fill(day > today ? Color.clear : shade(m, peak: peak))
                            .frame(width: 12, height: 12)
                    }
                }
            }
        }
    }

    private var unblockCard: some View {
        card {
            VStack(alignment: .leading, spacing: 6) {
                header("Unblocks", trailing: unblocksToday == 0 ? "none today" : "\(unblocksToday) today")
                Text("\(unblocksTotal)")
                    .font(.system(size: 26, weight: .semibold))
                    .monospacedDigit()
                Text(unblocksTotal == 0
                     ? "You have never cut a session short. That is the whole game."
                     : "Times you pressed Unblock anyway on the shield. Not a judgement, just the number.")
                    .font(.footnote)
                    .foregroundColor(normalTextColor.opacity(0.55))
            }
        }
    }

    private var allTimeCard: some View {
        card {
            VStack(spacing: 0) {
                statRow("Focused", human(totalMinutes))
                Divider().background(ruleColor)
                statRow("Sessions", "\(sessions)")
                Divider().background(ruleColor)
                statRow("Active days", "\(focusByDay.filter { $0.value > 0 }.count)")
            }
        }
    }

    // MARK: - Bits

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(cardColor)
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(ruleColor, lineWidth: 1))
            .cornerRadius(12)
    }

    private func header(_ title: String, trailing: String) -> some View {
        HStack {
            Text(title).font(.subheadline.weight(.semibold))
            Spacer()
            Text(trailing)
                .font(.footnote)
                .foregroundColor(normalTextColor.opacity(0.5))
        }
    }

    private func statRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.subheadline)
                .foregroundColor(normalTextColor.opacity(0.7))
            Spacer()
            Text(value)
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
        }
        .padding(.vertical, 8)
    }

    private func shade(_ minutes: Int, peak: Int) -> Color {
        guard minutes > 0 else { return ruleColor }
        let r = Double(minutes) / Double(peak)
        if r < 0.25 { return iconColor.opacity(0.3) }
        if r < 0.5 { return iconColor.opacity(0.55) }
        if r < 0.8 { return iconColor.opacity(0.8) }
        return iconColor
    }

    // MARK: - Data

    private func load() {
        focusByDay = History.focusByDay()
        streak = History.currentStreak()
        longest = History.longestStreak()
        unblocksTotal = History.unblocks
        unblocksToday = History.unblocksToday()
        sessions = History.sessions.count
    }

    private func minutesOn(_ date: Date) -> Int {
        (focusByDay[History.dayKey(date)] ?? 0) / 60
    }

    private var totalMinutes: Int {
        focusByDay.values.reduce(0, +) / 60
    }

    private var lastSevenDays: Int {
        lastDays(7).map { minutesOn($0) }.reduce(0, +)
    }

    private func lastDays(_ n: Int) -> [Date] {
        let today = cal.startOfDay(for: Date())
        return (0..<n).reversed().compactMap {
            cal.date(byAdding: .day, value: -$0, to: today)
        }
    }

    private func human(_ minutes: Int) -> String {
        if minutes < 60 { return "\(minutes) m" }
        let h = minutes / 60
        let m = minutes % 60
        return m == 0 ? "\(h) h" : "\(h) h \(m) m"
    }
}

#Preview { InsightsView() }
