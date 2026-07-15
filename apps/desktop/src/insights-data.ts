import type { Stats } from "./types";

/** Usage metrics derived from the on-device history. Everything here is real:
    focused seconds were measured by the engine, a tick at a time. */

export interface DayCell {
  key: string;
  date: Date;
  minutes: number;
  sessions: number;
  cancellations: number;
  activity: ActivitySlice[];
  cancellationMarkers: CancellationMarker[];
  future: boolean;
}

export interface ActivitySlice {
  top: number;
  height: number;
  working: boolean;
  scheduled: boolean;
}

export interface CancellationMarker {
  top: number;
  source: string;
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
  topSites: { domain: string; count: number }[];
  appsBlocked: number;
  sitesBlocked: number;
  cancellationsToday: number;
  cancellationsLast14: number;
  cancellationsTotal: number;
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
  const cancellationsOf = (key: string) => days[key]?.cancellations ?? 0;

  const activityFor = (ts: number): ActivitySlice[] => {
    const dayStart = new Date(ts);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    return (stats.activity ?? []).flatMap((span) => {
      const start = new Date(span.start);
      const end = new Date(span.end);
      if (
        !Number.isFinite(start.getTime()) ||
        !Number.isFinite(end.getTime()) ||
        end <= dayStart ||
        start >= dayEnd
      ) {
        return [];
      }
      const startMinute =
        start <= dayStart
          ? 0
          : start.getHours() * 60 + start.getMinutes() + start.getSeconds() / 60;
      const endMinute =
        end >= dayEnd
          ? 1440
          : end.getHours() * 60 + end.getMinutes() + end.getSeconds() / 60;
      return [{
        top: (startMinute / 1440) * 100,
        height: (Math.max(1, endMinute - startMinute) / 1440) * 100,
        working: span.working,
        scheduled: span.scheduled,
      }];
    });
  };

  const cancellationMarkersFor = (ts: number): CancellationMarker[] => {
    const key = dayKey(ts);
    return (stats.cancellations ?? []).flatMap((event) => {
      const at = new Date(event.occurredAt);
      if (!Number.isFinite(at.getTime()) || dayKey(at.getTime()) !== key) return [];
      const minute = at.getHours() * 60 + at.getMinutes() + at.getSeconds() / 60;
      return [{ top: (minute / 1440) * 100, source: event.source }];
    });
  };

  const activeKeys = Object.keys(days).filter(
    (k) => (days[k]?.focusSeconds ?? 0) > 0,
  );

  let totalMinutes = 0;
  let sessions = 0;
  let appsBlocked = 0;
  let sitesBlocked = 0;
  let cancellationsTotal = 0;
  for (const k of Object.keys(days)) {
    totalMinutes += minutesOf(k);
    sessions += sessionsOf(k);
    appsBlocked += days[k]?.appsBlocked ?? 0;
    sitesBlocked += days[k]?.sitesBlocked ?? 0;
    cancellationsTotal += cancellationsOf(k);
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
        cancellations: cancellationsOf(k),
        activity: activityFor(ts),
        cancellationMarkers: cancellationMarkersFor(ts),
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
      cancellations: cancellationsOf(k),
      activity: activityFor(ts),
      cancellationMarkers: cancellationMarkersFor(ts),
      future: false,
    });
  }

  const topApps = Object.entries(stats.blockedApps ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([app, count]) => ({ app, count }));

  const topSites = Object.entries(stats.blockedSites ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([domain, count]) => ({ domain, count }));

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
    topSites,
    appsBlocked,
    sitesBlocked,
    cancellationsToday: cancellationsOf(dayKey(today0)),
    cancellationsLast14: last14.reduce((sum, day) => sum + day.cancellations, 0),
    cancellationsTotal,
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
