/**
 * The service worker. Keeps the browser's rule set equal to what the contract
 * says should be blocked right now, and keeps a little honest history.
 *
 * MV3 kills this worker whenever it feels like it, so nothing lives in memory:
 * every tick reloads from storage, and an alarm (not a timer) brings us back.
 */

import { applyRules, currentDomains, load, sessionRunning, todayKey } from "./engine";

const TICK = "yf-tick";
/** One minute is the finest granularity chrome.alarms allows. */
const TICK_MINUTES = 1;

async function tick(): Promise<void> {
  const { config, session, days } = await load();
  const now = new Date();
  const running = sessionRunning(session, now.getTime());

  // An expired session is dead: write that down so every surface agrees.
  if (session.active && !running) {
    await chrome.storage.local.set({ session: { active: false, until: null } });
  }

  const { domains, reasons } = currentDomains(
    config,
    running ? session : { active: false, until: null },
    now,
  );

  await applyRules(domains);

  // Focused time, measured the same way the desktop app measures it: a tick is
  // only credited after it has elapsed with something actually blocked.
  if (domains.length > 0) {
    const key = todayKey(now);
    days[key] = (days[key] ?? 0) + TICK_MINUTES * 60;
    await chrome.storage.local.set({ days });
  }

  await paintIcon(domains.length > 0, reasons);
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
  if (msg?.type === "yf:attempt" && typeof msg.domain === "string") {
    void (async () => {
      const { attempts } = await load();
      attempts[msg.domain] = (attempts[msg.domain] ?? 0) + 1;
      await chrome.storage.local.set({ attempts });
      sendResponse({ ok: true });
    })();
    return true;
  }
  return false;
});
