/** Durable, local delivery of blocked-site attempts to desktop Insights. */

const HOST = "com.yawningface.desktop";
const QUEUE_KEY = "desktopQueue";
const MIGRATION_KEY = "desktopAttemptCountsMigrationV1";
const MAX_QUEUE = 1_000;

interface DesktopEvent {
  protocolVersion: 1;
  eventId: string;
  type: "site_blocked" | "site_counts";
  domain?: string;
  counts?: Record<string, number>;
  occurredAt: string;
}

let flushing: Promise<void> | null = null;

async function getQueue(): Promise<DesktopEvent[]> {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  return Array.isArray(stored[QUEUE_KEY])
    ? (stored[QUEUE_KEY] as DesktopEvent[])
    : [];
}

async function append(event: DesktopEvent): Promise<void> {
  const queue = await getQueue();
  queue.push(event);
  await chrome.storage.local.set({ [QUEUE_KEY]: queue.slice(-MAX_QUEUE) });
}

function send(event: DesktopEvent): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(HOST, event, (response) => {
        // Reading lastError inside the callback suppresses Chrome's noisy
        // unchecked-error log when the desktop app is not installed yet.
        const error = chrome.runtime.lastError;
        resolve(!error && response?.ok === true);
      });
    } catch {
      resolve(false);
    }
  });
}

async function flushNow(): Promise<void> {
  while (true) {
    const queue = await getQueue();
    const event = queue[0];
    if (!event || !(await send(event))) return;

    // Read again before removing: another blocked navigation may have appended
    // while the native process was starting.
    const latest = await getQueue();
    await chrome.storage.local.set({
      [QUEUE_KEY]: latest.filter((candidate) => candidate.eventId !== event.eventId),
    });
  }
}

export function flushDesktopEvents(): Promise<void> {
  if (!flushing) {
    flushing = flushNow().finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

export async function queueDesktopAttempt(domain: string): Promise<void> {
  await append({
    protocolVersion: 1,
    eventId: crypto.randomUUID(),
    type: "site_blocked",
    domain,
    occurredAt: new Date().toISOString(),
  });
  void flushDesktopEvents();
}

/**
 * v0.1.1 counted attempts inside Chrome before a desktop bridge existed. Send
 * that aggregate once, with a stable event ID, so upgrading does not erase the
 * history the user already saw on the blocked page.
 */
export async function queueLegacyAttemptCounts(): Promise<void> {
  const stored = await chrome.storage.local.get([MIGRATION_KEY, "attempts", QUEUE_KEY]);
  if (stored[MIGRATION_KEY]) return;

  const counts = {
    ...((stored.attempts as Record<string, number> | undefined) ?? {}),
  };
  const queue = Array.isArray(stored[QUEUE_KEY])
    ? (stored[QUEUE_KEY] as DesktopEvent[])
    : [];
  // Attempts already represented by a queued detailed event must not also be
  // included in the v0.1.1 aggregate migration.
  for (const pending of queue) {
    if (pending.type === "site_blocked" && pending.domain && counts[pending.domain]) {
      counts[pending.domain] -= 1;
      if (counts[pending.domain] <= 0) delete counts[pending.domain];
    }
  }
  const event: DesktopEvent | null = Object.keys(counts).length
    ? {
        protocolVersion: 1,
        eventId: `site-counts-v1-${chrome.runtime.id}`,
        type: "site_counts",
        counts,
        occurredAt: new Date().toISOString(),
      }
    : null;

  await chrome.storage.local.set({
    [MIGRATION_KEY]: true,
    [QUEUE_KEY]: event ? [...queue, event].slice(-MAX_QUEUE) : queue,
  });
}
