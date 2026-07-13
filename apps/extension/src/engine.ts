/**
 * The engine. Evaluates the same canonical config the desktop app, the CLI and
 * the phone evaluate, then compiles the result into declarativeNetRequest
 * rules so the browser itself does the blocking. No tab races, no content
 * script that a fast click can outrun.
 */

import {
  defaultConfig,
  evaluate,
  normalizeDomain,
  type BlockConfig,
} from "@yawningface/schema";

/** A one-click working session, exactly like the desktop app's. */
export interface Session {
  active: boolean;
  /** Epoch ms. null while active means "until I stop it". */
  until: number | null;
}

/** A domain let through on purpose, until a moment. */
export interface Unblock {
  domain: string;
  /** Epoch ms when the reprieve ends. */
  until: number;
  at: number;
}

export interface Stored {
  config: BlockConfig;
  session: Session;
  /** Focused seconds per local day, "YYYY-MM-DD". The insights the app shows. */
  days: Record<string, number>;
  /** Times a blocked page was refused, per domain. */
  attempts: Record<string, number>;
  /**
   * Every time you let yourself through, kept forever. The old extension
   * counted these too, and it was right to: an escape hatch whose cost you
   * never see is how a blocker quietly becomes decoration.
   */
  unblocks: Unblock[];
}

/** How long "Unblock anyway" buys you. Long enough to do the thing, short
    enough that you have to mean it again in a few minutes. */
export const UNBLOCK_MINUTES = 5;

/** The list the working session blocks, matching apps/desktop's defaults. */
export const DEFAULT_SESSION_DOMAINS = [
  "linkedin.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "tiktok.com",
  "facebook.com",
  "reddit.com",
  "youtube.com",
  "twitch.tv",
];

export const IDLE_SESSION: Session = { active: false, until: null };

export function sessionRunning(s: Session | undefined, now = Date.now()): boolean {
  if (!s?.active) return false;
  return s.until === null || now < s.until;
}

export async function load(): Promise<Stored> {
  const raw = await chrome.storage.local.get([
    "config",
    "session",
    "days",
    "attempts",
    "unblocks",
  ]);
  return {
    config: (raw.config as BlockConfig) ?? defaultConfig(),
    session: (raw.session as Session) ?? IDLE_SESSION,
    days: (raw.days as Record<string, number>) ?? {},
    attempts: (raw.attempts as Record<string, number>) ?? {},
    unblocks: (raw.unblocks as Unblock[]) ?? [],
  };
}

/** Domains currently let through on purpose. */
export function activeUnblocks(unblocks: Unblock[], now = Date.now()): string[] {
  return unblocks.filter((u) => u.until > now).map((u) => u.domain);
}

export function unblocksToday(unblocks: Unblock[], now = new Date()): number {
  const key = todayKey(now);
  return unblocks.filter((u) => todayKey(new Date(u.at)) === key).length;
}

/** Everything that should be blocked right now, from schedules + session,
    minus anything you have deliberately let through for a few minutes. */
export function currentDomains(
  config: BlockConfig,
  session: Session,
  unblocks: Unblock[] = [],
  now = new Date(),
): { domains: string[]; reasons: string[] } {
  const set = evaluate(config, "desktop", now);
  const domains = new Set<string>(set.domains);
  const reasons = [...set.activeLists];

  if (sessionRunning(session, now.getTime())) {
    reasons.push("Working session");
    for (const d of DEFAULT_SESSION_DOMAINS) domains.add(d);
  }

  for (const d of activeUnblocks(unblocks, now.getTime())) domains.delete(d);

  return { domains: [...domains].filter(Boolean), reasons };
}

/**
 * Rewrites the dynamic rule set to exactly these domains. Every rule redirects
 * the top-level navigation to our own page, so the user sees a reason rather
 * than a browser error.
 */
export async function applyRules(domains: string[]): Promise<void> {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);

  const addRules: chrome.declarativeNetRequest.Rule[] = domains.map(
    (domain, i) => ({
      id: i + 1,
      priority: 1,
      action: {
        type: "redirect" as chrome.declarativeNetRequest.RuleActionType,
        redirect: {
          regexSubstitution: chrome.runtime.getURL("blocked.html") + "?d=" + domain,
        },
      },
      condition: {
        // Matches the domain and every subdomain, but nothing that merely
        // contains it: "notx.com" must not match "x.com".
        regexFilter: `^https?://([a-z0-9-]+\\.)*${domain.replace(/\./g, "\\.")}(/|$|\\?)`,
        resourceTypes: [
          "main_frame" as chrome.declarativeNetRequest.ResourceType,
        ],
      },
    }),
  );

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules,
  });
}

export function todayKey(now = new Date()): string {
  const m = `${now.getMonth() + 1}`.padStart(2, "0");
  const d = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

/** Adds a blocklist made of loose domains, in the canonical shape. */
export function blocklistFromDomains(
  name: string,
  domains: string[],
  startTime: string,
  endTime: string,
  days: string[],
): BlockConfig["blocklists"][number] {
  return {
    id: `ext-${Date.now().toString(36)}`,
    name,
    metadata: {
      enabled: true,
      severity: "block",
      devices: ["desktop"],
      timePeriods: [
        {
          startTime,
          endTime,
          schedule: days as never,
        },
      ],
    },
    targets: {
      websites: domains.map(normalizeDomain).filter(Boolean),
      apps: [],
    },
  };
}
