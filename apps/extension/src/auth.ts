/**
 * Auth0 login for a browser extension: Authorization Code with PKCE, run
 * through `chrome.identity.launchWebAuthFlow`.
 *
 * The desktop app uses the Device Authorization Flow because a native app has
 * nowhere good to land a redirect. A browser does: Chrome gives every
 * extension a redirect URI at `https://<extension-id>.chromiumapp.org/`, and
 * that is what Auth0 must have in Allowed Callback URLs. The extension id is
 * derived from the `key` pinned in manifest.json, so the URI never moves.
 *
 * There is no client secret here, and there must never be one: an extension is
 * a public client and anything shipped inside it is public too. PKCE is what
 * makes that safe.
 */

import { isConfigured, loadSettings, type CloudSettings } from "./env";

export interface Tokens {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms. We refresh a minute early rather than race the clock. */
  expiresAt: number;
  userName: string | null;
  userEmail: string | null;
}

const SCOPES = "openid profile email offline_access";
/** Refresh this long before expiry, so a request never dies mid-flight. */
const REFRESH_MARGIN_MS = 60_000;

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64url(new Uint8Array(digest));
}

/** The claims we care about, read from the id_token without verifying it: the
    cloud verifies the access token, this is only for showing a name. */
function readIdToken(idToken: string | undefined): {
  name: string | null;
  email: string | null;
} {
  if (!idToken) return { name: null, email: null };
  try {
    const part = idToken.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const claims = JSON.parse(json) as { name?: string; email?: string };
    return { name: claims.name ?? null, email: claims.email ?? null };
  } catch {
    return { name: null, email: null };
  }
}

export function redirectUri(): string {
  return chrome.identity.getRedirectURL();
}

export async function loadTokens(): Promise<Tokens | null> {
  const { tokens } = await chrome.storage.local.get("tokens");
  return (tokens as Tokens) ?? null;
}

async function saveTokens(tokens: Tokens | null): Promise<void> {
  if (tokens) await chrome.storage.local.set({ tokens });
  else await chrome.storage.local.remove("tokens");
}

async function exchange(
  settings: CloudSettings,
  body: Record<string, string>,
): Promise<Tokens> {
  const resp = await fetch(`https://${settings.auth0Domain}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: settings.auth0ClientId,
      ...body,
    }),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };
  if (!resp.ok || !data.access_token) {
    throw new Error(
      data.error_description ?? data.error ?? `Auth0 returned ${resp.status}`,
    );
  }
  const { name, email } = readIdToken(data.id_token);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    userName: name,
    userEmail: email,
  };
}

/**
 * Opens Auth0 in a Chrome-managed window and comes back with tokens.
 * Must be called from an extension page (the options page), not the worker.
 */
export async function login(): Promise<Tokens> {
  const settings = await loadSettings();
  if (!isConfigured(settings)) {
    throw new Error("Set the Auth0 tenant and API base first.");
  }

  const verifier = randomVerifier();
  const challenge = await challengeFor(verifier);
  const state = randomVerifier();
  const redirect = redirectUri();

  const authorize = new URL(`https://${settings.auth0Domain}/authorize`);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: settings.auth0ClientId,
    redirect_uri: redirect,
    scope: SCOPES,
    audience: settings.auth0Audience,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  const returned = await chrome.identity.launchWebAuthFlow({
    url: authorize.toString(),
    interactive: true,
  });
  if (!returned) throw new Error("Login was cancelled.");

  const params = new URL(returned).searchParams;
  const error = params.get("error");
  if (error) {
    throw new Error(params.get("error_description") ?? error);
  }
  if (params.get("state") !== state) {
    throw new Error("Auth0 replied to a different request. Try again.");
  }
  const code = params.get("code");
  if (!code) throw new Error("Auth0 returned no authorization code.");

  const tokens = await exchange(settings, {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: redirect,
  });
  await saveTokens(tokens);
  return tokens;
}

/**
 * A usable access token, or null when signed out. A failed refresh signs the
 * user out quietly rather than blocking on a dialog: the extension keeps
 * blocking from its local config either way, which is the whole point.
 */
export async function freshAccessToken(
  settings: CloudSettings,
): Promise<Tokens | null> {
  const tokens = await loadTokens();
  if (!tokens) return null;
  if (Date.now() < tokens.expiresAt - REFRESH_MARGIN_MS) return tokens;
  if (!tokens.refreshToken) {
    await saveTokens(null);
    return null;
  }

  try {
    const refreshed = await exchange(settings, {
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    });
    // Auth0 only returns a new refresh token when rotation is on; keep the old
    // one otherwise, or the next refresh has nothing to work with.
    const next: Tokens = {
      ...refreshed,
      refreshToken: refreshed.refreshToken ?? tokens.refreshToken,
      userName: refreshed.userName ?? tokens.userName,
      userEmail: refreshed.userEmail ?? tokens.userEmail,
    };
    await saveTokens(next);
    return next;
  } catch {
    return null;
  }
}

/** Signs out locally and drops the cloud's config cache with it: what stays
    behind is the user's own local config, and nothing of the account. */
export async function logout(): Promise<void> {
  await saveTokens(null);
  await chrome.storage.local.remove(["cloudConfig", "queue"]);
}

/** Best-effort revocation of the refresh token, so signing out really ends it. */
export async function revoke(): Promise<void> {
  const settings = await loadSettings();
  const tokens = await loadTokens();
  if (!tokens?.refreshToken || !isConfigured(settings)) return;
  try {
    await fetch(`https://${settings.auth0Domain}/oauth/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: settings.auth0ClientId,
        token: tokens.refreshToken,
      }),
    });
  } catch {
    // Offline: the local tokens are gone anyway.
  }
}
