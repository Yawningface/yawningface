import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { computeInsights, humanMinutes, type DayCell } from "./insights-data";
import type { Stats } from "./types";

/** Half-dial: today's focused time against a day's target. */
function Gauge({ minutes, target }: { minutes: number; target: number }) {
  const r = 52;
  const len = Math.PI * r;
  const frac = Math.max(0, Math.min(1, minutes / target));
  const arc = `M ${64 - r} 64 A ${r} ${r} 0 0 1 ${64 + r} 64`;

  return (
    <div className="gauge">
      <svg viewBox="0 0 128 74" width="100%">
        <path d={arc} className="gauge-track" strokeWidth={12} strokeLinecap="round" />
        <path
          d={arc}
          className="gauge-fill"
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={`${frac * len} ${len}`}
        />
      </svg>
      <div className="gauge-label">
        <div className="gauge-value">{humanMinutes(minutes)}</div>
        <div className="small-text">focused today</div>
      </div>
    </div>
  );
}

function Bars({ days }: { days: DayCell[] }) {
  const max = Math.max(1, ...days.map((d) => d.minutes));
  return (
    <div className="bars">
      {days.map((d) => (
        <div className="bar-col" key={d.key}>
          <div className="bar-track">
            <div
              className={`bar ${d.minutes > 0 ? "on" : ""}`}
              style={{ height: `${Math.max(d.minutes > 0 ? 6 : 2, (d.minutes / max) * 100)}%` }}
              title={`${d.date.toLocaleDateString()} - ${humanMinutes(d.minutes)}`}
            />
          </div>
          <span className="bar-day">{d.date.getDate()}</span>
        </div>
      ))}
    </div>
  );
}

/** Four ink levels, so a light day and a heavy day never look the same. */
function level(minutes: number, max: number): string {
  if (minutes <= 0) return "l0";
  const r = minutes / max;
  if (r < 0.25) return "l1";
  if (r < 0.5) return "l2";
  if (r < 0.8) return "l3";
  return "l4";
}

function Heatmap({ weeks, max }: { weeks: DayCell[][]; max: number }) {
  return (
    <div className="heatmap-scroll">
      <div className="heatmap">
        {weeks.map((col, i) => (
          <div className="heat-col" key={i}>
            {col.map((cell) => (
              <div
                key={cell.key}
                className={`heat-cell ${cell.future ? "future" : level(cell.minutes, max)}`}
                title={
                  cell.future
                    ? ""
                    : `${cell.date.toLocaleDateString()} - ${humanMinutes(cell.minutes)}`
                }
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-row">
      <span className="muted">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

export default function Insights() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    invoke<Stats>("get_stats").then(setStats);
    const t = setInterval(() => {
      invoke<Stats>("get_stats").then(setStats);
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  const ins = useMemo(() => (stats ? computeInsights(stats) : null), [stats]);

  if (!ins) return <section className="page" />;

  if (ins.totalMinutes === 0 && ins.sessions === 0) {
    return (
      <section className="page">
        <h2>Insights</h2>
        <p className="page-note">
          Your focused time, measured on this machine and stored nowhere else.
        </p>
        <div className="empty">
          <div className="empty-emoji">😴</div>
          <b>Nothing to show yet</b>
          <p className="muted">
            Start a working session and this fills up: hours focused, streaks,
            and the apps that kept trying.
          </p>
        </div>
      </section>
    );
  }

  const maxHeat = Math.max(1, ...ins.weeks.flat().map((c) => c.minutes));

  return (
    <section className="page insights">
      <h2>Insights</h2>
      <p className="page-note">
        Focused time, measured on this machine. Nothing is uploaded, and nothing
        here is an estimate.
      </p>

      <div className="insight-grid">
        <section className="card">
          <b>Today</b>
          <Gauge minutes={ins.minutesToday} target={120} />
          <p className="small-text center">
            {humanMinutes(ins.minutesThisWeek)} in the last 7 days
          </p>
        </section>

        <section className="card wide">
          <div className="row">
            <b>Activity</b>
            <span className="small-text">last 14 days</span>
          </div>
          <Bars days={ins.last14} />
        </section>

        <section className="card wide">
          <div className="row">
            <div className="streak">
              <span className="streak-count">{ins.currentStreak}</span>
              <span className="streak-word">day streak</span>
            </div>
            <span className="small-text">longest {ins.longestStreak} days</span>
          </div>
          <Heatmap weeks={ins.weeks} max={maxHeat} />
          <div className="heat-legend small-text">
            less
            <span className="heat-cell l0" />
            <span className="heat-cell l1" />
            <span className="heat-cell l2" />
            <span className="heat-cell l3" />
            <span className="heat-cell l4" />
            more
          </div>
        </section>

        <section className="card">
          <b>All time</b>
          <div className="stats">
            <Stat label="Focused" value={humanMinutes(ins.totalMinutes)} />
            <Stat label="Sessions" value={`${ins.sessions}`} />
            <Stat label="Active days" value={`${ins.activeDays}`} />
            <Stat label="Best stretch" value={humanMinutes(ins.longestFocusMinutes)} />
            <Stat
              label="Typical day"
              value={humanMinutes(ins.avgMinutesPerActiveDay)}
            />
          </div>
        </section>

        <section className="card wide">
          <b>The ones that kept trying</b>
          <p className="muted">
            Apps yawningface closed for you while a block was on.
          </p>
          {ins.topApps.length === 0 ? (
            <p className="small-text">
              None yet. Websites are blocked silently, so only apps show up here.
            </p>
          ) : (
            <div className="app-tags">
              {ins.topApps.map((a) => (
                <span className="app-tag" key={a.app}>
                  {a.app}
                  <span className="app-count">{a.count}</span>
                </span>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
