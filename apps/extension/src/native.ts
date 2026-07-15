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

export interface DesktopState {
  available: boolean;
  domains: string[];
  reasons: string[];
  sessionUntil: string | null;
  focusedTodaySeconds: number;
  unblocksToday: number;
  /** Desktop owns appearance too. Optional keeps cached pre-0.1.4 state safe. */
  appearance?: "system" | "light" | "dark";
  updatedAt: string;
}

export function applyDesktopAppearance(state: DesktopState | null): void {
  document.documentElement.dataset.theme = state?.appearance ?? "system";
}

export interface DesktopUnblockResponse {
  ok: boolean;
  minutes?: number;
  until?: string;
  error?: string;
}

let flushing: Promise<void> | null = null;
let statePort: chrome.runtime.Port | null = null;
let statePoll: ReturnType<typeof setInterval> | null = null;

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

function sendNative<T>(message: object): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(HOST, message, (response) => {
        // Reading lastError inside the callback suppresses Chrome's noisy
        // unchecked-error log when the desktop app is not installed yet.
        const error = chrome.runtime.lastError;
        resolve(error ? null : (response as T));
      });
    } catch {
      resolve(null);
    }
  });
}

async function send(event: DesktopEvent): Promise<boolean> {
  const response = await sendNative<{ ok?: boolean }>(event);
  return response?.ok === true;
}

export async function getDesktopState(): Promise<DesktopState | null> {
  const response = await sendNative<{ ok?: boolean; state?: DesktopState }>({
    protocolVersion: 1,
    type: "get_state",
  });
  return response?.ok && response.state?.available ? response.state : null;
}

/** Keep one native connection open while Chrome is running. Besides avoiding
 * a process launch for every refresh, the port keeps the MV3 worker alive so
 * desktop-started sessions reach DNR rules within a couple of seconds. */
export function watchDesktopState(
  onState: (state: DesktopState | null) => void,
): () => void {
  let stopped = false;

  const connect = () => {
    if (stopped || statePort) return;
    try {
      const port = chrome.runtime.connectNative(HOST);
      statePort = port;
      const request = () => {
        try {
          port.postMessage({ protocolVersion: 1, type: "get_state" });
        } catch {
          // onDisconnect owns cleanup and reconnect.
        }
      };
      port.onMessage.addListener((message) => {
        onState(message?.ok && message.state?.available ? message.state : null);
      });
      port.onDisconnect.addListener(() => {
        // Read lastError to acknowledge Chrome's native-host error.
        void chrome.runtime.lastError;
        if (statePort === port) statePort = null;
        if (statePoll) clearInterval(statePoll);
        statePoll = null;
        onState(null);
        if (!stopped) setTimeout(connect, 2_000);
      });
      request();
      statePoll = setInterval(request, 2_000);
    } catch {
      statePort = null;
      if (!stopped) setTimeout(connect, 2_000);
    }
  };

  connect();
  return () => {
    stopped = true;
    if (statePoll) clearInterval(statePoll);
    statePoll = null;
    statePort?.disconnect();
    statePort = null;
  };
}

export async function requestDesktopUnblock(
  domain: string,
  reason: string,
): Promise<DesktopUnblockResponse> {
  const response = await sendNative<DesktopUnblockResponse>({
    protocolVersion: 1,
    eventId: crypto.randomUUID(),
    type: "unblock_request",
    domain,
    reason,
    occurredAt: new Date().toISOString(),
  });
  return response ?? {
    ok: false,
    error: "The yawningface desktop app is not connected.",
  };
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
