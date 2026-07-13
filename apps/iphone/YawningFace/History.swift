import Foundation

/// The on-device history behind Insights, shared through the App Group so the
/// app, the monitor extension and the shield action extension all write to the
/// same truth. Nothing here is estimated: a session contributes focused time
/// only for the stretch it actually ran, and an unblock is recorded the moment
/// you press the button on the shield.
///
/// Never leaves the phone.

struct SessionRecord: Codable, Identifiable {
    var id = UUID()
    /// When the session started.
    var start: Date
    /// When it actually ended. Nil while it is still running.
    var end: Date?
    /// How long it was asked for, in minutes. 0 means "until I stop it".
    var plannedMinutes: Int
    /// True when it ended because you unblocked, rather than running its course.
    var unblocked: Bool = false
    /// How many apps it was shielding.
    var appCount: Int = 0

    var focusedSeconds: Int {
        let stop = end ?? Date()
        return max(0, Int(stop.timeIntervalSince(start)))
    }
}

enum History {
    private static let group = UserDefaults(suiteName: "group.yawningface.block")
    private static let key = "history"

    static var sessions: [SessionRecord] {
        get {
            guard let data = group?.data(forKey: key),
                  let list = try? JSONDecoder().decode([SessionRecord].self, from: data)
            else { return [] }
            return list
        }
        set {
            // Keep it small: a year of sessions is plenty, and this lives in a
            // UserDefaults suite shared with two extensions.
            let trimmed = Array(newValue.suffix(2000))
            guard let data = try? JSONEncoder().encode(trimmed) else { return }
            group?.set(data, forKey: key)
        }
    }

    static func begin(plannedMinutes: Int, appCount: Int) {
        var all = sessions
        // A stale open record would poison every total; close it first.
        closeOpen(&all, unblocked: false)
        all.append(
            SessionRecord(
                start: Date(),
                end: nil,
                plannedMinutes: plannedMinutes,
                appCount: appCount
            )
        )
        sessions = all
    }

    /// Ends the running session. `unblocked` marks the ones you cut short.
    static func end(unblocked: Bool) {
        var all = sessions
        closeOpen(&all, unblocked: unblocked)
        sessions = all
    }

    private static func closeOpen(_ all: inout [SessionRecord], unblocked: Bool) {
        guard let i = all.lastIndex(where: { $0.end == nil }) else { return }
        all[i].end = Date()
        all[i].unblocked = unblocked
    }

    // MARK: - Derived

    static func dayKey(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }

    /// Focused seconds per local day. A session that crosses midnight counts
    /// against the day it started; good enough, and honest about it.
    static func focusByDay() -> [String: Int] {
        var out: [String: Int] = [:]
        for s in sessions {
            out[dayKey(s.start), default: 0] += s.focusedSeconds
        }
        return out
    }

    static var unblocks: Int { sessions.filter { $0.unblocked }.count }

    static func unblocksToday() -> Int {
        let today = dayKey(Date())
        return sessions.filter { $0.unblocked && dayKey($0.start) == today }.count
    }

    /// Consecutive days with focused time, ending today (or yesterday, so a day
    /// you have not started yet does not break it).
    static func currentStreak() -> Int {
        let days = Set(focusByDay().filter { $0.value > 0 }.keys)
        var streak = 0
        var cursor = Date()
        if !days.contains(dayKey(cursor)) {
            cursor = cursor.addingTimeInterval(-86_400)
        }
        while days.contains(dayKey(cursor)) {
            streak += 1
            cursor = cursor.addingTimeInterval(-86_400)
        }
        return streak
    }

    static func longestStreak() -> Int {
        let days = focusByDay().filter { $0.value > 0 }.keys.sorted()
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        var best = 0
        var run = 0
        var previous: Date?
        for key in days {
            guard let d = f.date(from: key) else { continue }
            if let p = previous, Int(d.timeIntervalSince(p)) == 86_400 {
                run += 1
            } else {
                run = 1
            }
            best = max(best, run)
            previous = d
        }
        return best
    }
}
