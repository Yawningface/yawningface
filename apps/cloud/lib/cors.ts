import { NextResponse } from "next/server";

/**
 * CORS for /api/v1/* - the Chrome extension (and any browser client) calls
 * these endpoints cross-origin with an Authorization header.
 */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

/** JSON response with CORS headers attached. */
export function json(data: unknown, init?: { status?: number }): NextResponse {
  return NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: CORS_HEADERS,
  });
}

/** Shared OPTIONS (preflight) handler for /api/v1 routes. */
export function preflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Map a thrown error to a JSON response. AuthError-like objects (with a
 * numeric `status`) keep their status; anything else is a 500.
 */
export function errorResponse(err: unknown): NextResponse {
  const status =
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : 500;
  const message =
    err instanceof Error && status !== 500 ? err.message : "Internal error";
  if (status === 500) {
    console.error(err);
  }
  return json({ error: message }, { status });
}
