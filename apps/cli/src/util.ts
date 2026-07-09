import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { BlockConfig, DayOfWeek, TimePeriod } from "@yawningface/schema";
import { DAY_KEYS, validateConfig } from "@yawningface/schema";

/** Default config file location, unless --file or YF_CONFIG says otherwise. */
export const DEFAULT_CONFIG_FILE = "yawningface.json";

export function resolveConfigPath(flag: string | undefined): string {
  return resolve(flag ?? process.env.YF_CONFIG ?? DEFAULT_CONFIG_FILE);
}

/**
 * Load KEY=VALUE pairs from the nearest .env, walking up from cwd. Real
 * environment variables always win; set YF_DISABLE_DOTENV=1 to skip entirely.
 */
export function loadDotEnv(): void {
  if (process.env.YF_DISABLE_DOTENV === "1") return;
  let dir = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      for (const line of readFileSync(candidate, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/** Read + parse + minimally validate a config file. Throws with a friendly message. */
export function readConfig(path: string): BlockConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `no config found at ${path} — create one with "yf init" or point at one with --file`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  const problem = validateConfig(parsed);
  if (problem !== null) {
    throw new Error(`${path} is not a valid config: ${problem}`);
  }
  return parsed as BlockConfig;
}

const DAY_LABELS: Record<DayOfWeek, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

/** "mon,tue,wed,thu,fri" -> "Mon–Fri"; [] -> "Every day". */
export function renderDays(schedule: DayOfWeek[]): string {
  const days = DAY_KEYS.filter((d) => schedule.includes(d));
  if (days.length === 0 || days.length === 7) return "Every day";
  const runs: DayOfWeek[][] = [];
  for (const day of days) {
    const lastRun = runs[runs.length - 1];
    const prevIndex = lastRun ? DAY_KEYS.indexOf(lastRun[lastRun.length - 1]) : -2;
    if (lastRun && DAY_KEYS.indexOf(day) === prevIndex + 1) {
      lastRun.push(day);
    } else {
      runs.push([day]);
    }
  }
  return runs
    .map((run) =>
      run.length >= 3
        ? `${DAY_LABELS[run[0]]}–${DAY_LABELS[run[run.length - 1]]}`
        : run.map((d) => DAY_LABELS[d]).join(", "),
    )
    .join(", ");
}

export function renderWindow(period: TimePeriod): string {
  return `${renderDays(period.schedule ?? [])} ${period.startTime}–${period.endTime}`;
}

export function renderWindows(periods: TimePeriod[] | undefined): string {
  if (!periods || periods.length === 0) return "Always";
  return periods.map(renderWindow).join("; ");
}
