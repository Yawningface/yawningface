import { requireAuth } from "@/lib/auth";
import { errorResponse, json, preflight } from "@/lib/cors";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_BATCH = 500;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function OPTIONS() {
  return preflight();
}

/**
 * POST /api/v1/events with body
 *   { deviceId, events: [{ type, occurredAt, payload? }] }
 * → { inserted }
 *
 * Batch-ingests client telemetry (blocked attempts, session starts, …) and
 * touches the device's last_seen_at.
 */
export async function POST(req: Request) {
  try {
    const user = await requireAuth(req);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body must be valid JSON" }, { status: 400 });
    }
    const { deviceId, events } = (body ?? {}) as {
      deviceId?: unknown;
      events?: unknown;
    };

    if (typeof deviceId !== "string" || !UUID_RE.test(deviceId)) {
      return json({ error: "deviceId must be a UUID" }, { status: 400 });
    }
    if (!Array.isArray(events) || events.length === 0) {
      return json({ error: "events must be a non-empty array" }, { status: 400 });
    }
    if (events.length > MAX_BATCH) {
      return json(
        { error: `events is capped at ${MAX_BATCH} per batch` },
        { status: 400 }
      );
    }

    const rows: Array<{
      user_id: string;
      device_id: string;
      type: string;
      payload: unknown;
      occurred_at: string;
    }> = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i] as {
        type?: unknown;
        occurredAt?: unknown;
        payload?: unknown;
      } | null;
      if (typeof ev?.type !== "string" || ev.type.length === 0) {
        return json(
          { error: `events[${i}].type must be a non-empty string` },
          { status: 400 }
        );
      }
      if (
        typeof ev.occurredAt !== "string" ||
        Number.isNaN(Date.parse(ev.occurredAt))
      ) {
        return json(
          { error: `events[${i}].occurredAt must be an ISO 8601 date string` },
          { status: 400 }
        );
      }
      if (
        ev.payload !== undefined &&
        (typeof ev.payload !== "object" ||
          ev.payload === null ||
          Array.isArray(ev.payload))
      ) {
        return json(
          { error: `events[${i}].payload must be an object` },
          { status: 400 }
        );
      }
      rows.push({
        user_id: user.sub,
        device_id: deviceId,
        type: ev.type,
        payload: ev.payload ?? {},
        occurred_at: new Date(ev.occurredAt).toISOString(),
      });
    }

    const db = getDb();
    const { error } = await db.from("events").insert(rows);
    if (error) throw new Error(error.message);

    // Touch the device; ignore result (the device may not be registered yet).
    await db
      .from("devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", deviceId)
      .eq("user_id", user.sub);

    return json({ inserted: rows.length });
  } catch (err) {
    return errorResponse(err);
  }
}
