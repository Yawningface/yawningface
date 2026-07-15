/**
 * @yawningface/schema - the cross-device contract.
 *
 * One JSON document per user. The cloud stores it verbatim (last write wins)
 * and never interprets it; every client evaluates it locally. This package is
 * the single source of truth for the document's shape and for the evaluation
 * semantics. The Rust engine (apps/desktop/src-tauri/src/schedule.rs) and the
 * Swift models (apps/iphone) must match the behaviour tested here.
 */

// ---------------------------------------------------------------------------
// Types (contract v1)
// ---------------------------------------------------------------------------

/** Device categories a blocklist applies to. */
export type DeviceKind = "desktop" | "mobile" | "tablet";

/** How aggressively targets are enforced. v1 clients implement "block". */
export type Severity = "block" | "warn";

/** Three-letter lowercase day-of-week codes, Monday first. */
export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const DAY_KEYS: readonly DayOfWeek[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

export const DEVICE_KINDS: readonly DeviceKind[] = [
  "desktop",
  "mobile",
  "tablet",
];

/**
 * A daily time window during which the blocklist is active.
 * Times are 24h "HH:MM" strings, evaluated by clients in their own local time.
 * `startTime === endTime` means the whole day. A window whose end is before
 * its start crosses midnight (e.g. 22:00 -> 07:00).
 */
export interface TimePeriod {
  /** Inclusive start, e.g. "09:00". */
  startTime: string;
  /** Exclusive end, e.g. "13:00". */
  endTime: string;
  /** Days this window applies to. Empty = every day. */
  schedule: DayOfWeek[];
}

export interface BlocklistMetadata {
  /** Master switch. Disabled blocklists are never enforced. */
  enabled: boolean;
  severity: Severity;
  /** Which device categories should enforce this blocklist. */
  devices: DeviceKind[];
  /**
   * Informational in v1: clients evaluate timePeriods in their own local
   * time zone, not this one.
   */
  timeZone?: string;
  /** Empty or missing = always active while enabled. */
  timePeriods?: TimePeriod[];
}

export interface BlocklistTargets {
  /** Bare domains, e.g. "twitter.com". Clients match subdomains too. */
  websites: string[];
  /** App names as reported by the OS, e.g. "Discord". */
  apps: string[];
}

export interface Blocklist {
  /** Stable slug-like identifier, unique within the config. */
  id: string;
  /** Human-readable name. */
  name: string;
  metadata: BlocklistMetadata;
  targets: BlocklistTargets;
  /** Reserved for v2 (temporary allowances / smart friction). Always [] in v1. */
  exceptions: unknown[];
}

export interface BlockConfig {
  /** Schema version. Currently always 1. */
  version: 1;
  blocklists: Blocklist[];
}

/** Default config handed to a user who has never saved one. */
export function defaultConfig(): BlockConfig {
  return {
    version: 1,
    blocklists: [
      {
        id: "morning-focus",
        name: "Morning Focus",
        metadata: {
          enabled: false,
          severity: "block",
          devices: ["desktop", "mobile", "tablet"],
          timePeriods: [
            {
              startTime: "09:00",
              endTime: "13:00",
              schedule: ["mon", "tue", "wed", "thu", "fri"],
            },
          ],
        },
        targets: {
          websites: ["twitter.com", "youtube.com", "instagram.com"],
          apps: [],
        },
        exceptions: [],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Minimal structural validation - intentionally byte-compatible with what the
 * cloud accepts on PUT /api/v1/config (apps/cloud/lib/schema.ts). The server
 * is lenient so old servers never reject newer well-formed documents.
 * Returns an error message, or null if the shape is acceptable.
 */
export function validateConfig(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "config must be a JSON object";
  }
  const obj = value as Record<string, unknown>;
  if (obj.version !== 1) {
    return "config.version must be 1";
  }
  if (!Array.isArray(obj.blocklists)) {
    return "config.blocklists must be an array";
  }
  for (let i = 0; i < obj.blocklists.length; i++) {
    const bl = obj.blocklists[i];
    if (typeof bl !== "object" || bl === null || Array.isArray(bl)) {
      return `blocklists[${i}] must be an object`;
    }
    const b = bl as Record<string, unknown>;
    if (typeof b.id !== "string" || b.id.length === 0) {
      return `blocklists[${i}].id must be a non-empty string`;
    }
    if (typeof b.name !== "string" || b.name.length === 0) {
      return `blocklists[${i}].name must be a non-empty string`;
    }
    if (typeof b.metadata !== "object" || b.metadata === null) {
      return `blocklists[${i}].metadata must be an object`;
    }
    if (typeof b.targets !== "object" || b.targets === null) {
      return `blocklists[${i}].targets must be an object`;
    }
  }
  return null;
}

const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;

/**
 * Strict canonical validation - what well-behaved producers (CLI, coach,
 * client UIs) must emit. Unknown fields are allowed everywhere so newer
 * documents keep validating on older code. Returns a list of problems;
 * empty list = valid.
 */
export function validateConfigStrict(value: unknown): string[] {
  const problems: string[] = [];
  const minimal = validateConfig(value);
  if (minimal !== null) {
    return [minimal];
  }
  const config = value as Record<string, unknown>;
  const lists = config.blocklists as unknown[];
  const seenIds = new Set<string>();

  lists.forEach((raw, i) => {
    const at = `blocklists[${i}]`;
    const b = raw as Record<string, unknown>;

    const id = b.id as string;
    if (seenIds.has(id)) {
      problems.push(`${at}.id "${id}" is duplicated`);
    }
    seenIds.add(id);

    const meta = b.metadata as Record<string, unknown>;
    if (typeof meta.enabled !== "boolean") {
      problems.push(`${at}.metadata.enabled must be a boolean`);
    }
    if (meta.severity !== "block" && meta.severity !== "warn") {
      problems.push(`${at}.metadata.severity must be "block" or "warn"`);
    }
    if (!Array.isArray(meta.devices)) {
      problems.push(`${at}.metadata.devices must be an array`);
    } else {
      for (const d of meta.devices) {
        if (!DEVICE_KINDS.includes(d as DeviceKind)) {
          problems.push(`${at}.metadata.devices contains unknown kind ${JSON.stringify(d)}`);
        }
      }
    }
    if (meta.timeZone !== undefined && typeof meta.timeZone !== "string") {
      problems.push(`${at}.metadata.timeZone must be a string when present`);
    }
    if (meta.timePeriods !== undefined) {
      if (!Array.isArray(meta.timePeriods)) {
        problems.push(`${at}.metadata.timePeriods must be an array when present`);
      } else {
        meta.timePeriods.forEach((p, j) => {
          const pat = `${at}.metadata.timePeriods[${j}]`;
          if (typeof p !== "object" || p === null) {
            problems.push(`${pat} must be an object`);
            return;
          }
          const period = p as Record<string, unknown>;
          for (const key of ["startTime", "endTime"] as const) {
            const t = period[key];
            if (typeof t !== "string" || !HHMM.test(t)) {
              problems.push(`${pat}.${key} must be a 24h "HH:MM" string`);
            }
          }
          if (!Array.isArray(period.schedule)) {
            problems.push(`${pat}.schedule must be an array of day codes`);
          } else {
            for (const d of period.schedule) {
              if (!DAY_KEYS.includes(d as DayOfWeek)) {
                problems.push(`${pat}.schedule contains unknown day ${JSON.stringify(d)} (use ${DAY_KEYS.join("/")})`);
              }
            }
          }
        });
      }
    }

    const targets = b.targets as Record<string, unknown>;
    for (const key of ["websites", "apps"] as const) {
      const arr = targets[key];
      if (!Array.isArray(arr) || arr.some((x) => typeof x !== "string")) {
        problems.push(`${at}.targets.${key} must be an array of strings`);
      }
    }

    if (b.exceptions !== undefined && !Array.isArray(b.exceptions)) {
      problems.push(`${at}.exceptions must be an array when present`);
    }
  });

  return problems;
}

// ---------------------------------------------------------------------------
// Evaluation - parity with apps/desktop/src-tauri/src/schedule.rs
// ---------------------------------------------------------------------------

/** The set of targets a device must block right now. */
export interface BlockSet {
  domains: Set<string>;
  apps: Set<string>;
  activeLists: string[];
}

/** Day key for a Date, in the date's local time. */
export function dayKeyFromDate(date: Date): DayOfWeek {
  // JS getDay(): 0 = Sunday. Contract days are Monday-first.
  return DAY_KEYS[(date.getDay() + 6) % 7];
}

/**
 * Normalize "https://www.Twitter.com/foo" or "Twitter.com " to "twitter.com".
 * Returns "" for anything that does not look like a domain.
 */
export function normalizeDomain(raw: string): string {
  let s = raw.trim().toLowerCase();
  for (const prefix of ["https://", "http://"]) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length);
    }
  }
  const slash = s.indexOf("/");
  if (slash !== -1) {
    s = s.slice(0, slash);
  }
  if (s.startsWith("www.")) {
    s = s.slice(4);
  }
  if (s.length === 0 || !s.includes(".") || !/^[a-z0-9.-]+$/.test(s)) {
    return "";
  }
  return s;
}

function parseHHMM(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parts = value.split(":");
  if (parts.length !== 2) return null;
  const h = parts[0].trim();
  const m = parts[1].trim();
  if (!/^\d+$/.test(h) || !/^\d+$/.test(m)) return null;
  const hours = Number(h);
  const minutes = Number(m);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function periodActive(period: unknown, minutesNow: number, day: string): boolean {
  if (typeof period !== "object" || period === null) return true;
  const p = period as Record<string, unknown>;

  // Accept "mon" / "monday" / "Mon" ... Empty = every day.
  const matchesDay = (candidate: string) =>
    !Array.isArray(p.schedule) ||
    p.schedule.length === 0 ||
    p.schedule.some(
      (d) => typeof d === "string" && d.toLowerCase().startsWith(candidate),
    );

  const start = parseHHMM(p.startTime);
  const end = parseHHMM(p.endTime);
  if (start === null || end === null) {
    return matchesDay(day); // malformed times -> fail closed towards blocking
  }
  if (start === end) return matchesDay(day); // equal times = whole selected day
  if (start < end) return matchesDay(day) && minutesNow >= start && minutesNow < end;
  if (minutesNow >= start) return matchesDay(day);
  if (minutesNow < end) {
    const index = DAY_KEYS.indexOf(day as DayOfWeek);
    const previousDay = DAY_KEYS[(index + DAY_KEYS.length - 1) % DAY_KEYS.length];
    return matchesDay(previousDay);
  }
  return false;
}

function metadataActive(meta: Record<string, unknown>, minutesNow: number, day: string): boolean {
  const periods = meta.timePeriods;
  if (!Array.isArray(periods) || periods.length === 0) {
    return true; // no schedule -> always active while enabled
  }
  return periods.some((p) => periodActive(p, minutesNow, day));
}

function appliesToDevice(meta: Record<string, unknown>, device: DeviceKind): boolean {
  const devices = meta.devices;
  if (!Array.isArray(devices)) {
    return true; // no device filter -> applies everywhere
  }
  return devices.some(
    (d) => typeof d === "string" && d.toLowerCase() === device,
  );
}

function strArray(value: unknown, key: string): string[] {
  if (typeof value !== "object" || value === null) return [];
  const arr = (value as Record<string, unknown>)[key];
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is string => typeof x === "string");
}

/**
 * Pure evaluation at an explicit local time. `minutesNow` is minutes since
 * local midnight; `day` is the current day key. Deliberately tolerant of
 * malformed documents, exactly like the Rust engine.
 */
export function evaluateAt(
  config: unknown,
  minutesNow: number,
  day: string,
  device: DeviceKind,
): BlockSet {
  const out: BlockSet = { domains: new Set(), apps: new Set(), activeLists: [] };
  if (typeof config !== "object" || config === null) return out;
  const lists = (config as Record<string, unknown>).blocklists;
  if (!Array.isArray(lists)) return out;

  for (const raw of lists) {
    if (typeof raw !== "object" || raw === null) continue;
    const list = raw as Record<string, unknown>;
    const meta = (typeof list.metadata === "object" && list.metadata !== null
      ? list.metadata
      : {}) as Record<string, unknown>;

    if (meta.enabled !== true) continue;
    if (!appliesToDevice(meta, device)) continue;
    if (!metadataActive(meta, minutesNow, day)) continue;

    out.activeLists.push(typeof list.name === "string" ? list.name : "Unnamed");

    for (const d of strArray(list.targets, "websites")) {
      const domain = normalizeDomain(d);
      if (domain !== "") out.domains.add(domain);
    }
    for (const a of strArray(list.targets, "apps")) {
      const app = a.trim();
      if (app !== "") out.apps.add(app);
    }
  }
  return out;
}

/** Evaluate a config for a device at a wall-clock moment (default: now). */
export function evaluate(
  config: unknown,
  device: DeviceKind,
  now: Date = new Date(),
): BlockSet {
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  return evaluateAt(config, minutesNow, dayKeyFromDate(now), device);
}
