/**
 * Where the cloud is, and who we are to it.
 *
 * Same story as the desktop app's Settings: CI bakes the tenant in at build
 * time (esbuild `define`), and every value stays overridable at runtime from
 * the options page, so a local build with no env vars still works.
 */

declare const __YF_API_BASE__: string;
declare const __YF_AUTH0_DOMAIN__: string;
declare const __YF_AUTH0_CLIENT_ID__: string;
declare const __YF_AUTH0_AUDIENCE__: string;

export interface CloudSettings {
  apiBase: string;
  auth0Domain: string;
  auth0ClientId: string;
  auth0Audience: string;
  /** What this browser is called in Insights. "Windows PC (gaming)". */
  deviceName: string;
  /** Assigned by the cloud on first registration, then reused forever. */
  deviceId: string | null;
}

const BUILD_DEFAULTS = {
  apiBase: __YF_API_BASE__,
  auth0Domain: __YF_AUTH0_DOMAIN__,
  auth0ClientId: __YF_AUTH0_CLIENT_ID__,
  auth0Audience: __YF_AUTH0_AUDIENCE__,
};

const OS_NAMES: Record<string, string> = {
  win: "Windows",
  mac: "Mac",
  linux: "Linux",
  cros: "ChromeOS",
  android: "Android",
  openbsd: "OpenBSD",
  fuchsia: "Fuchsia",
};

/** "Chrome on Windows", until the user renames it to something they recognise. */
export async function defaultDeviceName(): Promise<string> {
  try {
    const { os } = await chrome.runtime.getPlatformInfo();
    return `Chrome on ${OS_NAMES[os] ?? os}`;
  } catch {
    return "Chrome";
  }
}

export async function loadSettings(): Promise<CloudSettings> {
  const { settings } = await chrome.storage.local.get("settings");
  const stored = (settings ?? {}) as Partial<CloudSettings>;
  return {
    apiBase: stored.apiBase ?? BUILD_DEFAULTS.apiBase,
    auth0Domain: stored.auth0Domain ?? BUILD_DEFAULTS.auth0Domain,
    auth0ClientId: stored.auth0ClientId ?? BUILD_DEFAULTS.auth0ClientId,
    auth0Audience: stored.auth0Audience ?? BUILD_DEFAULTS.auth0Audience,
    deviceName: stored.deviceName ?? (await defaultDeviceName()),
    deviceId: stored.deviceId ?? null,
  };
}

export async function saveSettings(
  patch: Partial<CloudSettings>,
): Promise<CloudSettings> {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

/** No tenant, no sync. The extension is then exactly what it was before. */
export function isConfigured(s: CloudSettings): boolean {
  return Boolean(
    s.apiBase && s.auth0Domain && s.auth0ClientId && s.auth0Audience,
  );
}

/** Trailing slashes are the classic way to get a 404 from a fine server. */
export function apiUrl(s: CloudSettings, path: string): string {
  return `${s.apiBase.replace(/\/+$/, "")}${path}`;
}
