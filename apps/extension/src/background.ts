/**
 * The service worker. Keeps the browser's rule set equal to what the contract
 * says should be blocked right now, and keeps a little honest history.
 *
 * MV3 kills this worker whenever it feels like it, so nothing lives in memory:
 * every tick reloads from storage, and an alarm (not a timer) brings us back.
 *
 * When signed in, the same tick also talks to the cloud: pull the account's
 * config, ship the events. Signed out, that call returns immediately and the
 * extension is an island, blocking from local storage and answering to nobody.
 */

import {
  UNBLOCK_MINUTES,
  applyRules,
  currentDomains,
  load,
  sessionRunning,
  todayKey,
  type Session,
} from "./engine";
import { queueEvent, syncCloud } from "./cloud";
import {
  flushDesktopEvents,
  queueDesktopAttempt,
  queueLegacyAttemptCounts,
} from "./native";

const TICK = "yf-tick";
/** One minute is the finest granularity chrome.alarms allows. */
const TICK_MINUTES = 1;
/** The desktop heartbeats every five minutes. Match it, so that "last seen"
    means the same thing on every row of the devices table. */
const HEARTBEAT_EVERY_TICKS = 5;

async function tick(): Promise<void> {
  const { config, cloudConfig, session, days, unblocks } = await load();
  const now = new Date();
  const running = sessionRunning(session, now.getTime());

  // An expired session is dead: write that down so every surface agrees.
  if (session.active && !running) {
    await chrome.storage.local.set({ session: { active: false, until: null } });
    await queueEvent("session_stop", { expired: true });
  }

  const { domains, reasons } = currentDomains(
    config,
    running ? session : { active: false, until: null },
    unblocks,
    now,
    cloudConfig,
  );

  await applyRules(domains);
  await reportBlockSet(domains, reasons);

  // Focused time, measured the same way the desktop app measures it: a tick is
  // only credited after it has elapsed with something actually blocked.
  if (domains.length > 0) {
    const key = todayKey(now);
    days[key] = (days[key] ?? 0) + TICK_MINUTES * 60;
    await chrome.storage.local.set({ days });
  }

  await paintIcon(domains.length > 0, reasons);
  await beat();
  await syncCloud();
  await queueLegacyAttemptCounts();
  void flushDesktopEvents();
}

/** An event when the block set actually changes, rather than once a minute
    for as long as the browser is open. */
async function reportBlockSet(
  domains: string[],
  reasons: string[],
): Promise<void> {
  const signature = domains.slice().sort().join(",");
  const { lastApplied } = await chrome.storage.local.get("lastApplied");
  if (signature === lastApplied) return;
  await chrome.storage.local.set({ lastApplied: signature });
  await queueEvent("blocking_applied", {
    domains: domains.length,
    apps: 0,
    lists: reasons,
  });
}

async function beat(): Promise<void> {
  const { ticks } = await chrome.storage.local.get("ticks");
  const n = ((ticks as number) ?? 0) + 1;
  await chrome.storage.local.set({ ticks: n });
  if (n % HEARTBEAT_EVERY_TICKS === 1) await queueEvent("heartbeat");
}

/** The toolbar icon is the switch, exactly like the tray icon on the desktop. */
async function paintIcon(blocking: boolean, reasons: string[]): Promise<void> {
  await chrome.action.setBadgeText({ text: blocking ? " " : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#f0db0c" });
  await chrome.action.setTitle({
    title: blocking
      ? `yawningface: blocking (${reasons.join(", ") || "on"})`
      : "yawningface: off",
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(TICK, { periodInMinutes: TICK_MINUTES });
  await tick();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(TICK, { periodInMinutes: TICK_MINUTES });
  await tick();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TICK) void tick();
});

// The popup and options page ask for an immediate re-evaluation after any edit,
// rather than letting the user wait up to a minute to see their own change.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "yf:apply") {
    void tick().then(() => sendResponse({ ok: true }));
    return true;
  }

  // Starting and ending a session goes through here, so the event is recorded
  // once, in one place, whichever surface asked for it.
  if (msg?.type === "yf:session" && msg.session) {
    void (async () => {
      const session = msg.session as Session;
      await chrome.storage.local.set({ session });
      await queueEvent(session.active ? "session_start" : "session_stop", {
        minutes: session.until
          ? Math.round((session.until - Date.now()) / 60_000)
          : 0,
      });
      await tick();
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (msg?.type === "yf:attempt" && typeof msg.domain === "string") {
    void (async () => {
      const { attempts } = await load();
      attempts[msg.domain] = (attempts[msg.domain] ?? 0) + 1;
      await chrome.storage.local.set({ attempts });
      await queueEvent("site_blocked", { domain: msg.domain });
      await queueDesktopAttempt(msg.domain);
      sendResponse({ ok: true });
    })();
    return true;
  }

  // "Unblock anyway": let this one domain through for a few minutes, and keep
  // the receipt. Same mechanic as the shield on the phone.
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
      const { unblocks } = await load();
      unblocks.push({
        domain: msg.domain,
        at: Date.now(),
        until: Date.now() + UNBLOCK_MINUTES * 60_000,
        reason,
      });
      await chrome.storage.local.set({ unblocks: unblocks.slice(-500) });
      await queueEvent("unblock_used", {
        domain: msg.domain,
        minutes: UNBLOCK_MINUTES,
      });
      await tick();
      sendResponse({ ok: true, minutes: UNBLOCK_MINUTES });
    })();
    return true;
  }
  return false;
});
