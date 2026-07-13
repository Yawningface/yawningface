import type { Stats } from "./types";

/** Usage metrics derived from the on-device history. Everything here is real:
    focused seconds were measured by the engine, a tick at a time. */

export interface DayCell {
  key: string;
  date: Date;
  minutes: number;
  sessions: number;
  future: boolean;
}

export interface Insights {
  totalMinutes: number;
  minutesToday: number;
  minutesThisWeek: number;
  sessions: number;
  activeDays: number;
  avgMinutesPerActiveDay: number;
  longestFocusMinutes: number;
  currentStreak: number;
  longestStreak: number;
  topApps: { app: string; count: number }[];
  appsBlocked: number;
  last14: DayCell[];
  weeks: DayCell[][];
  maxDayMinutes: number;
}

const DAY = 86_400_000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local date key, matching the "YYYY-MM-DD" the Rust side writes. */
function dayKey(ts: number): string {
  const d = new Date(ts);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function computeInsights(stats: Stats, now = Date.now()): Insights {
  const days = stats.days ?? {};
  const today0 = startOfDay(now);

  const minutesOf = (key: string) =>
    Math.round((days[key]?.focusSeconds ?? 0) / 60);
  const sessionsOf = (key: string) => days[key]?.sessions ?? 0;

  const activeKeys = Object.keys(days).filter(
    (k) => (days[k]?.focusSeconds ?? 0) > 0,
  );

  let totalMinutes = 0;
  let sessions = 0;
  let appsBlocked = 0;
  for (const k of Object.keys(days)) {
    totalMinutes += minutesOf(k);
    sessions += sessionsOf(k);
    appsBlocked += days[k]?.appsBlocked ?? 0;
  }

  let minutesThisWeek = 0;
  for (let i = 0; i < 7; i++) {
    minutesThisWeek += minutesOf(dayKey(today0 - i * DAY));
  }

  // Streak: consecutive days with focused time, ending today (or yesterday, so
  // that a day you have not started yet does not break it).
  let currentStreak = 0;
  {
    let cursor = today0;
    if (!activeKeys.includes(dayKey(cursor))) cursor -= DAY;
    while (activeKeys.includes(dayKey(cursor))) {
      currentStreak++;
      cursor -= DAY;
    }
  }

  let longestStreak = 0;
  {
    const sorted = activeKeys
      .map((k) => {
        const [y, m, d] = k.split("-").map(Number);
        return new Date(y, m - 1, d).getTime();
      })
      .sort((a, b) => a - b);
    let run = 0;
    let prev = NaN;
    for (const d of sorted) {
      run = !Number.isNaN(prev) && d - prev === DAY ? run + 1 : 1;
      if (run > longestStreak) longestStreak = run;
      prev = d;
    }
  }

  // Heatmap: 17 weeks of columns, aligned to Monday.
  const WEEKS = 17;
  const dow = (new Date(today0).getDay() + 6) % 7; // Monday = 0
  const thisMonday = today0 - dow * DAY;
  const gridStart = thisMonday - (WEEKS - 1) * 7 * DAY;
  const weeks: DayCell[][] = [];
  for (let w = 0; w < WEEKS; w++) {
    const col: DayCell[] = [];
    for (let d = 0; d < 7; d++) {
      const ts = gridStart + (w * 7 + d) * DAY;
      const k = dayKey(ts);
      col.push({
        key: k,
        date: new Date(ts),
        minutes: minutesOf(k),
        sessions: sessionsOf(k),
        future: ts > today0,
      });
    }
    weeks.push(col);
  }

  const last14: DayCell[] = [];
  for (let i = 13; i >= 0; i--) {
    const ts = today0 - i * DAY;
    const k = dayKey(ts);
    last14.push({
      key: k,
      date: new Date(ts),
      minutes: minutesOf(k),
      sessions: sessionsOf(k),
      future: false,
    });
  }

  const topApps = Object.entries(stats.blockedApps ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([app, count]) => ({ app, count }));

  const activeDays = activeKeys.length;

  return {
    totalMinutes,
    minutesToday: minutesOf(dayKey(today0)),
    minutesThisWeek,
    sessions,
    activeDays,
    avgMinutesPerActiveDay: activeDays
      ? Math.round(totalMinutes / activeDays)
      : 0,
    longestFocusMinutes: Math.round((stats.longestFocusSeconds ?? 0) / 60),
    currentStreak,
    longestStreak,
    topApps,
    appsBlocked,
    last14,
    weeks,
    maxDayMinutes: Math.max(1, ...last14.map((d) => d.minutes), 1),
  };
}

/** "2 h 15 m", "45 m", "0 m" */
export function humanMinutes(min: number): string {
  if (min < 60) return `${min} m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} m` : `${h} h`;
}
