/**
 * Canonical blocklist config schema — the cross-device contract.
 *
 * Every client (desktop, extension, iPhone) reads and writes this exact shape
 * via GET/PUT /api/v1/config. See docs/schema.md for the full specification.
 */

/** Device categories a blocklist applies to. */
export type DeviceKind = "desktop" | "mobile" | "tablet";

/** How aggressively targets are enforced. v1 clients implement "block". */
export type Severity = "block" | "warn";

/** Three-letter lowercase day-of-week codes. */
export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/**
 * A daily time window during which the blocklist is active.
 * Times are 24h "HH:MM" strings, evaluated by clients in their own local time.
 */
export interface TimePeriod {
  /** Inclusive start, e.g. "09:00". */
  startTime: string;
  /** Exclusive end, e.g. "13:00". */
  endTime: string;
  /** Days this window applies to. */
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
  /**
   * Empty or missing = always active while enabled.
   */
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
  /** Reserved for v2 (temporary allowances). Always [] in v1. */
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
          timeZone: "Europe/Madrid",
          timePeriods: [
            {
              startTime: "09:00",
              endTime: "13:00",
              schedule: ["mon", "tue", "wed", "thu", "fri"],
            },
          ],
        },
        targets: {
          websites: ["twitter.com", "linkedin.com"],
          apps: ["Discord", "Steam"],
        },
        exceptions: [],
      },
    ],
  };
}

/**
 * Minimal structural validation for an incoming config.
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
