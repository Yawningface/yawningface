/**
 * Browser companion service worker.
 *
 * Desktop owns sessions, schedules, exemptions, and history. The extension's
 * job is deliberately smaller: mirror desktop's active domain set into DNR so
 * navigation redirects before hosts/DNS, render the block page, and relay the
 * user's attempts and reason-gated exceptions back to desktop Insights.
 */

import { applyRules } from "./rules";
import {
  flushDesktopEvents,
  getDesktopState,
  queueDesktopAttempt,
  queueLegacyAttemptCounts,
  requestDesktopUnblock,
  watchDesktopState,
  type DesktopState,
} from "./native";

const TICK = "yf-desktop-state";
const TICK_MINUTES = 0.5;

interface BridgeUnblock {
  domain: string;
  until: number;
}

async function activeUnblocks(now = Date.now()): Promise<BridgeUnblock[]> {
  const stored = await chrome.storage.local.get("bridgeUnblocks");
  const active = ((stored.bridgeUnblocks as BridgeUnblock[] | undefined) ?? []).filter(
    (event) => event.until > now,
  );
  await chrome.storage.local.set({ bridgeUnblocks: active });
  return active;
}

async function applyDesktopState(
  fresh: DesktopState | null,
  connected: boolean,
): Promise<void> {
  const stored = await chrome.storage.local.get("desktopState");
  const state = fresh ?? (stored.desktopState as DesktopState | undefined) ?? null;
  if (fresh) await chrome.storage.local.set({ desktopState: fresh });
  await chrome.storage.local.set({ desktopConnected: connected });

  const exemptions = new Set((await activeUnblocks()).map((event) => event.domain));
  const domains = (state?.domains ?? []).filter((domain) => !exemptions.has(domain));
  await applyRules(domains);
  await paintIcon(domains.length > 0, state?.reasons ?? [], connected);
  await chrome.storage.local.remove("desktopBridgeError");
}

async function refresh(): Promise<DesktopState | null> {
  const state = await getDesktopState();
  await applyDesktopState(state, state !== null);
  await queueLegacyAttemptCounts();
  void flushDesktopEvents();
  return state;
}

async function paintIcon(
  blocking: boolean,
  reasons: string[],
  connected: boolean,
): Promise<void> {
  await chrome.action.setBadgeText({ text: blocking ? " " : connected ? "" : "!" });
  await chrome.action.setBadgeBackgroundColor({ color: blocking ? "#f0db0c" : "#c65a19" });
  await chrome.action.setTitle({
    title: !connected
      ? "yawningface: desktop disconnected"
      : blocking
        ? `yawningface: blocking (${reasons.join(", ") || "desktop"})`
        : "yawningface: off",
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(TICK, { periodInMinutes: TICK_MINUTES });
  await refresh();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(TICK, { periodInMinutes: TICK_MINUTES });
  await refresh();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK) void refresh();
});

// A persistent native port keeps desktop state and browser rules within a
// couple of seconds of one another. The alarm above remains the recovery path.
watchDesktopState((state) => {
  void applyDesktopState(state, state !== null).catch(async (error) => {
    await chrome.storage.local.set({ desktopBridgeError: String(error) });
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "yf:apply" || msg?.type === "yf:refresh") {
    void (async () => {
      try {
        const state = await refresh();
        sendResponse({
          ok: state !== null,
          connected: state !== null,
          updatedAt: state?.updatedAt ?? null,
          error: state ? null : "The desktop native bridge did not reply.",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await chrome.storage.local.set({ desktopBridgeError: message });
        sendResponse({ ok: false, connected: false, error: message });
      }
    })();
    return true;
  }

  if (msg?.type === "yf:attempt" && typeof msg.domain === "string") {
    void (async () => {
      const stored = await chrome.storage.local.get(["attempts", "desktopState"]);
      const attempts =
        (stored.attempts as Record<string, number> | undefined) ?? {};
      const state = (stored.desktopState as DesktopState | undefined) ?? null;
      const exemptions = new Set(
        (await activeUnblocks()).map((event) => event.domain),
      );
      if (!state?.domains.includes(msg.domain) || exemptions.has(msg.domain)) {
        sendResponse({ ok: false, attempts: attempts[msg.domain] ?? 0 });
        return;
      }
      attempts[msg.domain] = (attempts[msg.domain] ?? 0) + 1;
      await chrome.storage.local.set({ attempts });
      await queueDesktopAttempt(msg.domain);
      sendResponse({ ok: true, attempts: attempts[msg.domain] });
    })();
    return true;
  }

  if (
    msg?.type === "yf:unblock" &&
    typeof msg.domain === "string" &&
    typeof msg.reason === "string"
  ) {
    void (async () => {
      const reason = msg.reason.trim();
      if (!reason) {
        sendResponse({ ok: false, error: "Write a reason before unblocking." });
        return;
      }
      const response = await requestDesktopUnblock(msg.domain, reason);
      if (!response.ok || !response.minutes || !response.until) {
        sendResponse(response);
        return;
      }

      const stored = await chrome.storage.local.get("bridgeUnblocks");
      const unblocks =
        (stored.bridgeUnblocks as BridgeUnblock[] | undefined) ?? [];
      unblocks.push({
        domain: msg.domain,
        until: new Date(response.until).getTime(),
      });
      await chrome.storage.local.set({ bridgeUnblocks: unblocks.slice(-100) });
      await applyDesktopState(null, true);
      sendResponse(response);
    })();
    return true;
  }

  return false;
});
