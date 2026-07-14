/**
 * The other half of the contract: the extension as a signed-in client.
 *
 * Deliberately the same shape as the desktop app's `sync.rs`, because the two
 * are talking to the same three endpoints:
 *
 *   1. register this browser at POST /api/v1/devices  (platform "extension")
 *   2. pull the account's config from GET /api/v1/config, cache it, enforce it
 *      alongside the local one
 *   3. flush queued events to POST /api/v1/events, so Chrome shows up in
 *      Insights next to the Mac and the phone
 *
 * Signed out, none of this runs and none of it is missed: the extension blocks
 * from its own local config exactly as it did before there was an account.
 * That is the island, and it stays a first-class way to use this thing.
 *
 * The cloud config is pulled, never pushed. The desktop app does the same: the
 * document you edit here is the local one, and the account's document is
 * merged on top of it. Two clients last-write-winning a shared document every
 * 60 seconds is how you lose a blocklist you meant to keep.
 */

import type { BlockConfig } from "@yawningface/schema";
import { freshAccessToken, type Tokens } from "./auth";
import { apiUrl, isConfigured, loadSettings, saveSettings } from "./env";

/** Same event vocabulary the desktop emits, so one dashboard reads both. */
export interface OutEvent {
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

/** The server caps a batch at 500; keep a bounded backlog for offline spells. */
const MAX_QUEUE = 1000;
const MAX_BATCH = 500;

export interface SyncStatus {
  configured: boolean;
  signedIn: boolean;
  userName: string | null;
  userEmail: string | null;
  deviceName: string;
  lastSync: string | null;
  lastSyncError: string | null;
  queued: number;
}

export async function queueEvent(
  type: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const settings = await loadSettings();
  // Nothing to send events to, and no account to attach them to: don't hoard.
  if (!isConfigured(settings)) return;

  const { queue } = await chrome.storage.local.get("queue");
  const events = ((queue as OutEvent[]) ?? []).concat({
    type,
    occurredAt: new Date().toISOString(),
    payload,
  });
  await chrome.storage.local.set({ queue: events.slice(-MAX_QUEUE) });
}

export async function loadStatus(): Promise<SyncStatus> {
  const settings = await loadSettings();
  const [{ tokens }, { queue }, { lastSync }, { lastSyncError }] =
    await Promise.all([
      chrome.storage.local.get("tokens"),
      chrome.storage.local.get("queue"),
      chrome.storage.local.get("lastSync"),
      chrome.storage.local.get("lastSyncError"),
    ]);
  const t = tokens as Tokens | undefined;
  return {
    configured: isConfigured(settings),
    signedIn: Boolean(t),
    userName: t?.userName ?? null,
    userEmail: t?.userEmail ?? null,
    deviceName: settings.deviceName,
    lastSync: (lastSync as string) ?? null,
    lastSyncError: (lastSyncError as string) ?? null,
    queued: ((queue as OutEvent[]) ?? []).length,
  };
}

/**
 * One round trip with the cloud. Called from the worker's tick; never throws,
 * because a server having a bad day must not stop the browser from blocking.
 */
export async function syncCloud(): Promise<void> {
  const settings = await loadSettings();
  if (!isConfigured(settings)) return;

  const tokens = await freshAccessToken(settings);
  if (!tokens) return; // signed out, or the refresh token finally died

  try {
    // Register when this browser has no id yet, and again whenever it has been
    // renamed: the devices table is what Insights labels a chart with, so a
    // rename that never leaves the browser is a rename that did not happen.
    const { deviceSyncedName } = await chrome.storage.local.get("deviceSyncedName");
    const deviceId =
      settings.deviceId && deviceSyncedName === settings.deviceName
        ? settings.deviceId
        : await registerDevice(tokens);
    await pullConfig(tokens);
    await flushEvents(tokens, deviceId);
    await chrome.storage.local.set({
      lastSync: new Date().toISOString(),
      lastSyncError: null,
    });
  } catch (err) {
    await chrome.storage.local.set({
      lastSyncError: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Registers this browser, or refreshes its row, and remembers the id. */
export async function registerDevice(tokens: Tokens): Promise<string> {
  const settings = await loadSettings();
  const resp = await fetch(apiUrl(settings, "/api/v1/devices"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      deviceId: settings.deviceId ?? undefined,
      name: settings.deviceName,
      platform: "extension",
      appVersion: chrome.runtime.getManifest().version,
    }),
  });
  if (!resp.ok) {
    throw new Error(`Device registration failed (${resp.status})`);
  }
  const body = (await resp.json()) as { deviceId?: string };
  if (!body.deviceId) throw new Error("Server response missing deviceId");
  await saveSettings({ deviceId: body.deviceId });
  await chrome.storage.local.set({ deviceSyncedName: settings.deviceName });
  return body.deviceId;
}

/** The account's document, cached so the last known config survives offline. */
async function pullConfig(tokens: Tokens): Promise<void> {
  const settings = await loadSettings();
  const resp = await fetch(apiUrl(settings, "/api/v1/config"), {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  if (!resp.ok) throw new Error(`Server returned ${resp.status} for /config`);
  const body = (await resp.json()) as { config?: BlockConfig };
  if (body.config) {
    await chrome.storage.local.set({ cloudConfig: body.config });
  }
}

/** Ships the backlog. On failure the batch goes back on the queue: an event
    that never arrives is a lie in a chart later. */
async function flushEvents(tokens: Tokens, deviceId: string): Promise<void> {
  const { queue } = await chrome.storage.local.get("queue");
  const pending = (queue as OutEvent[]) ?? [];
  if (pending.length === 0) return;

  const batch = pending.slice(0, MAX_BATCH);
  const rest = pending.slice(MAX_BATCH);
  await chrome.storage.local.set({ queue: rest });

  const settings = await loadSettings();
  try {
    const resp = await fetch(apiUrl(settings, "/api/v1/events"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ deviceId, events: batch }),
    });
    if (!resp.ok) throw new Error(`Events rejected (${resp.status})`);
  } catch (err) {
    const { queue: now } = await chrome.storage.local.get("queue");
    const restored = batch.concat((now as OutEvent[]) ?? []);
    await chrome.storage.local.set({ queue: restored.slice(-MAX_QUEUE) });
    throw err;
  }
}
