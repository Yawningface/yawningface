import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Blocklist, TimePeriod } from "./types";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const HOUR_HEIGHT = 18;
const DAY_HEIGHT = HOUR_HEIGHT * 24;
const PALETTE_SIZE = 6;

type CalendarSegment = {
  scheduleIndex: number;
  name: string;
  enabled: boolean;
  start: number;
  end: number;
  timing: ScheduleTiming;
  edge: "whole" | "start" | "end";
};

type PositionedSegment = CalendarSegment & {
  column: number;
  columns: number;
};

export type ScheduleTiming = {
  range: string;
  detail: string;
  startLabel: string;
  endLabel: string;
  durationMinutes: number;
  overnight: boolean;
  allDay: boolean;
};

function parseMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatClock(value: string): string {
  const minutes = parseMinutes(value);
  if (minutes === null) return value;
  const hours = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minute.toString().padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}

function formatDuration(minutes: number): string {
  if (minutes === 1440) return "24 hours";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder} min`;
  if (remainder === 0) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${hours} h ${remainder} min`;
}

export function describeSchedulePeriod(period: Pick<TimePeriod, "startTime" | "endTime">): ScheduleTiming {
  const start = parseMinutes(period.startTime);
  const end = parseMinutes(period.endTime);
  if (start === null || end === null) {
    return {
      range: `${period.startTime} → ${period.endTime}`,
      detail: "Check these times",
      startLabel: period.startTime,
      endLabel: period.endTime,
      durationMinutes: 0,
      overnight: false,
      allDay: false,
    };
  }

  const allDay = start === end;
  const overnight = !allDay && end < start;
  const durationMinutes = allDay ? 1440 : end > start ? end - start : 1440 - start + end;
  return {
    range: `${formatClock(period.startTime)} → ${formatClock(period.endTime)}${overnight ? " next day" : ""}`,
    detail: `${allDay ? "All day" : overnight ? "Overnight" : "Same day"} · ${formatDuration(durationMinutes)}`,
    startLabel: formatClock(period.startTime),
    endLabel: formatClock(period.endTime),
    durationMinutes,
    overnight,
    allDay,
  };
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function sameDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayKey(date: Date): string {
  return DAY_KEYS[date.getDay()];
}

function selectedOn(period: TimePeriod, date: Date): boolean {
  const selected = period.schedule ?? [];
  if (selected.length === 0) return true;
  const key = dayKey(date);
  return selected.some((day) => day.toLowerCase().startsWith(key));
}

function segmentsForDay(lists: Blocklist[], date: Date): CalendarSegment[] {
  const segments: CalendarSegment[] = [];
  const previousDate = addDays(date, -1);

  lists.forEach((list, scheduleIndex) => {
    for (const period of list.metadata?.timePeriods ?? []) {
      const start = parseMinutes(period.startTime);
      const end = parseMinutes(period.endTime);
      if (start === null || end === null) continue;
      const timing = describeSchedulePeriod(period);
      const common = {
        scheduleIndex,
        name: list.name,
        enabled: !!list.metadata?.enabled,
        timing,
      };

      if (start === end) {
        if (selectedOn(period, date)) {
          segments.push({ ...common, start: 0, end: 1440, edge: "whole" });
        }
      } else if (start < end) {
        if (selectedOn(period, date)) {
          segments.push({ ...common, start, end, edge: "whole" });
        }
      } else {
        if (selectedOn(period, previousDate) && end > 0) {
          segments.push({ ...common, start: 0, end, edge: "end" });
        }
        if (selectedOn(period, date) && start < 1440) {
          segments.push({ ...common, start, end: 1440, edge: "start" });
        }
      }
    }
  });

  return segments;
}

function positionSegments(segments: CalendarSegment[]): PositionedSegment[] {
  const ordered = [...segments].sort((a, b) => a.start - b.start || b.end - a.end);
  const columnEnds: number[] = [];
  const positioned = ordered.map((segment) => {
    let column = columnEnds.findIndex((end) => end <= segment.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(segment.end);
    } else {
      columnEnds[column] = segment.end;
    }
    return { ...segment, column, columns: 1 };
  });
  const columns = Math.max(columnEnds.length, 1);
  return positioned.map((segment) => ({ ...segment, columns }));
}

function rangeLabel(start: Date): string {
  const end = addDays(start, 6);
  const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  const startText = monthDay.format(start);
  const endText = monthDay.format(end);
  return start.getFullYear() === end.getFullYear()
    ? `${startText} – ${endText}, ${end.getFullYear()}`
    : `${startText}, ${start.getFullYear()} – ${endText}, ${end.getFullYear()}`;
}

export default function ScheduleCalendar({ lists }: { lists: Blocklist[] }) {
  const [now, setNow] = useState(() => new Date());
  const [dayOffset, setDayOffset] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const rangeStart = useMemo(() => addDays(startOfDay(now), dayOffset), [dayOffset, now]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(rangeStart, index)),
    [rangeStart],
  );
  const daySegments = useMemo(
    () =>
      days.map((date) =>
        positionSegments(segmentsForDay(lists, date).filter((segment) => segment.enabled)),
      ),
    [lists, days],
  );
  const startsToday = dayOffset === 0;
  const hasBlocks = daySegments.some((segments) => segments.length > 0);
  const clockHours = Array.from({ length: 24 }, (_, hour) => hour);

  return (
    <section className="card schedule-calendar" aria-label={`Schedule calendar for ${rangeLabel(rangeStart)}`}>
      <div className="schedule-calendar-toolbar">
        <div>
          <b>{startsToday ? "Today + 6 days" : "Upcoming 7 days"}</b>
          <span className="small-text">{rangeLabel(rangeStart)}</span>
        </div>
        <div className="schedule-calendar-actions" aria-label="Change date range">
          <button
            className="ghost small calendar-arrow"
            aria-label="Previous 7 days"
            disabled={startsToday}
            onClick={() => setDayOffset((offset) => Math.max(0, offset - 7))}
          >
            ←
          </button>
          <button
            className="ghost small"
            disabled={startsToday}
            onClick={() => setDayOffset(0)}
          >
            Today
          </button>
          <button
            className="ghost small calendar-arrow"
            aria-label="Next 7 days"
            onClick={() => setDayOffset((offset) => offset + 7)}
          >
            →
          </button>
        </div>
      </div>

      <div className="schedule-calendar-frame">
        <div className="schedule-calendar-head" aria-hidden="true">
          <span />
          {days.map((date) => (
            <span className={`calendar-day-head ${sameDate(date, now) ? "today" : ""}`} key={date.toISOString()}>
              <span>
                {sameDate(date, now)
                  ? "Today"
                  : date.toLocaleDateString("en-US", { weekday: "short" })}
              </span>
              <b>{date.getDate()}</b>
            </span>
          ))}
        </div>
        <div className="schedule-calendar-body" style={{ "--calendar-day-height": `${DAY_HEIGHT}px`, "--calendar-hour-height": `${HOUR_HEIGHT}px` } as CSSProperties}>
          <div className="calendar-time-axis" aria-hidden="true">
            {clockHours.map((hour) => (
              <span style={{ top: hour * HOUR_HEIGHT }} key={hour}>
                {formatClock(`${hour.toString().padStart(2, "0")}:00`).replace(":00", "")}
              </span>
            ))}
          </div>
          <div className="calendar-day-lanes">
            {days.map((date, dayIndex) => (
              <div className={`calendar-day-lane ${sameDate(date, now) ? "today" : ""}`} key={date.toISOString()}>
                {daySegments[dayIndex].map((segment, segmentIndex) => {
                  const top = (segment.start / 60) * HOUR_HEIGHT;
                  const height = Math.max(((segment.end - segment.start) / 60) * HOUR_HEIGHT, 16);
                  const width = 100 / segment.columns;
                  const label = `${segment.name}, ${segment.timing.range}, ${segment.enabled ? "enabled" : "off"}`;
                  const blockTime = segment.timing.allDay
                    ? "All day"
                    : segment.edge === "start"
                      ? `from ${segment.timing.startLabel}`
                      : segment.edge === "end"
                        ? `until ${segment.timing.endLabel}`
                        : `${segment.timing.startLabel} – ${segment.timing.endLabel}`;
                  return (
                    <div
                      className={`calendar-block calendar-tone-${segment.scheduleIndex % PALETTE_SIZE} ${segment.enabled ? "" : "disabled"}`}
                      style={{
                        top,
                        height,
                        left: `calc(${segment.column * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                      }}
                      aria-label={label}
                      key={`${segment.scheduleIndex}-${segment.start}-${segment.end}-${segmentIndex}`}
                    >
                      <b>{segment.name}</b>
                      {segment.end - segment.start >= 120 && <span>{blockTime}</span>}
                    </div>
                  );
                })}
                {sameDate(date, now) && (
                  <span
                    className="calendar-now-line"
                    style={{ top: ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT }}
                    aria-label={`Current time ${formatClock(`${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`)}`}
                  />
                )}
              </div>
            ))}
            {!hasBlocks && <div className="calendar-empty">No schedules in these 7 days.</div>}
          </div>
        </div>
      </div>
    </section>
  );
}
