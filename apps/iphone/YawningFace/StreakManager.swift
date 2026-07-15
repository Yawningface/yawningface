import Foundation

// The streak, derived from one source of truth.
//
// There used to be two streak engines: this one (a UserDefaults counter poked
// on launch) and History (derived from real session records). They could report
// different numbers on the same screen. History wins - a streak is "days you
// actually focused", which is what Insights already shows - and this type is now
// a thin read-only facade so every caller (Profile, the challenge screen) agrees.

enum StreakManager {
    /// Consecutive days with focused time, ending today or yesterday.
    static var currentStreak: Int { History.currentStreak() }

    /// The best run ever.
    static var longestStreak: Int { History.longestStreak() }

    // The old mutating entry points are kept so existing callers compile, but
    // they no longer keep a parallel counter: the streak is computed from the
    // session history that start()/stop()/unblock already record.
    static func checkAndUpdateStreak() {}
    static func startStreakIfNeeded() {}
    static func resetStreak() {}
}
