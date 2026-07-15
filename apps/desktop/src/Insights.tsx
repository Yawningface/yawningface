import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { computeInsights, humanMinutes, type DayCell } from "./insights-data";
import type { Stats } from "./types";

function Bars({ days }: { days: DayCell[] }) {
  return (
    <div className="timeline-wrap">
      <div className="timeline-axis small-text" aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
      <div className="bars">
        {days.map((d) => (
          <div className="bar-col" key={d.key}>
            <div
              className="bar-track"
              title={`${d.date.toLocaleDateString()} - ${humanMinutes(d.minutes)}, ${d.cancellations} deactivations`}
            >
              {d.activity.map((span, i) => (
                <div key={i}>
                  {span.scheduled && (
                    <span
                      className="activity-span scheduled"
                      style={{ top: `${span.top}%`, height: `${span.height}%` }}
                    />
                  )}
                  {span.working && (
                    <span
                      className="activity-span working"
                      style={{ top: `${span.top}%`, height: `${span.height}%` }}
                    />
                  )}
                </div>
              ))}
              {d.cancellationMarkers.map((marker, i) => (
                <span
                  key={`cancel-${i}`}
                  className="cancel-marker"
                  style={{ top: `${marker.top}%` }}
                  title={`${marker.source} session deactivated`}
                />
              ))}
            </div>
            <span className="bar-day">
              {d.date.toLocaleDateString([], { weekday: "narrow" })}
              <b>{d.date.getDate()}</b>
            </span>
          </div>
        ))}
      </div>
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

  if (
    ins.totalMinutes === 0 &&
    ins.sessions === 0 &&
    ins.topSites.length === 0 &&
    ins.topApps.length === 0 &&
    ins.recentUnblocks.length === 0
  ) {
    return (
      <section className="page">
        <h2>Insights</h2>
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

      <div className="insight-grid">
        <section className="card wide">
          <div className="row">
            <b>Activity</b>
            <span className="small-text">last 14 days</span>
          </div>
          <div className="activity-legend small-text">
            <span><i className="legend-off" />off</span>
            <span><i className="legend-scheduled" />scheduled</span>
            <span><i className="legend-working" />working session</span>
            <span><i className="legend-cancelled" />deactivated</span>
          </div>
          <Bars days={ins.last14} />
        </section>

        <section className="card wide deactivation-card">
          <div>
            <b>Blocker deactivations</b>
            <p className="muted">
              Working sessions ended early or active schedules switched off.
            </p>
          </div>
          <div className="deactivation-numbers">
            <span><b>{ins.cancellationsToday}</b><small>today</small></span>
            <span><b>{ins.cancellationsLast14}</b><small>last 14 days</small></span>
          </div>
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

        <section className="card wide">
          <b>Websites that kept trying</b>
          <p className="muted">
            Navigations stopped by the yawningface browser extension.
          </p>
          {ins.topSites.length === 0 ? (
            <p className="small-text">
              None yet. Attempts will appear here after the browser extension
              and desktop app connect.
            </p>
          ) : (
            <div className="app-tags">
              {ins.topSites.map((site) => (
                <span className="app-tag" key={site.domain}>
                  {site.domain}
                  <span className="app-count">{site.count}</span>
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="card wide">
          <b>Apps that kept trying</b>
          <p className="muted">
            Apps yawningface closed for you while a block was on.
          </p>
          {ins.topApps.length === 0 ? (
            <p className="small-text">None yet.</p>
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

        <section className="card wide">
          <div>
            <b>Times you bent the block</b>
            <p className="muted">
              Temporary access you chose, with the reason you gave yourself.
            </p>
          </div>
          {ins.recentUnblocks.length === 0 ? (
            <p className="small-text">None yet.</p>
          ) : (
            <div className="unblock-log">
              {ins.recentUnblocks.map((event, index) => (
                <div className="unblock-log-row" key={`${event.occurredAt}-${event.domain}-${index}`}>
                  <div>
                    <b>{event.domain}</b>
                    <p>{event.reason}</p>
                  </div>
                  <span className="small-text">
                    {event.minutes} min / {new Date(event.occurredAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
