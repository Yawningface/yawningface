import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { getDb } from "./db";

/**
 * Bearer-token authentication against Auth0.
 *
 * Clients (desktop app via Device Authorization Flow, extension, iPhone app)
 * obtain an access token from Auth0 and send it as `Authorization: Bearer …`.
 * We validate signature, issuer and audience against the tenant's JWKS.
 * The token's `sub` claim is the canonical user id everywhere in the system.
 */

export interface AuthedUser {
  /** Auth0 `sub` claim, e.g. "auth0|64f0c…". Canonical user id. */
  sub: string;
  email?: string;
  name?: string;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (jwks) return jwks;
  const domain = process.env.AUTH0_DOMAIN;
  if (!domain) {
    throw new Error("AUTH0_DOMAIN must be set (see .env.example)");
  }
  jwks = createRemoteJWKSet(
    new URL(`https://${domain}/.well-known/jwks.json`)
  );
  return jwks;
}

/**
 * Verify the request's Bearer token. Throws AuthError (401) on any failure.
 * Also upserts the caller's `profiles` row from token claims so every table
 * can reference a known user.
 */
export async function requireAuth(req: Request): Promise<AuthedUser> {
  const domain = process.env.AUTH0_DOMAIN;
  const audience = process.env.AUTH0_AUDIENCE;
  if (!domain || !audience) {
    throw new Error(
      "AUTH0_DOMAIN and AUTH0_AUDIENCE must be set (see .env.example)"
    );
  }

  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new AuthError("Missing Bearer token");
  }

  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(match[1], getJwks(), {
      issuer: `https://${domain}/`,
      audience,
    });
    payload = verified.payload;
  } catch {
    throw new AuthError("Invalid or expired token");
  }

  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new AuthError("Token has no sub claim");
  }

  const user: AuthedUser = {
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    name: typeof payload.name === "string" ? payload.name : undefined,
  };

  await upsertProfile(user);
  return user;
}

async function upsertProfile(user: AuthedUser): Promise<void> {
  const row: Record<string, unknown> = { user_id: user.sub };
  if (user.email) row.email = user.email;
  if (user.name) row.display_name = user.name;

  const { error } = await getDb()
    .from("profiles")
    .upsert(row, { onConflict: "user_id" });
  if (error) {
    throw new Error(`Failed to upsert profile: ${error.message}`);
  }
}
