import { requireAuth } from "@/lib/auth";
import { errorResponse, json, preflight } from "@/lib/cors";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * GET /api/v1/summary → last-7-days aggregates.
 *
 * {
 *   since, until,
 *   eventsPerDay: [{ date: "2026-07-01", counts: { block_attempt: 12, … } }],
 *   devices: [{ deviceId, name, platform, appVersion, lastSeenAt }]
 * }
 *
 * This feeds the future AI daily digest.
 */
export async function GET(req: Request) {
  try {
    const user = await requireAuth(req);
    const db = getDb();

    const until = new Date();
    const since = new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [eventsRes, devicesRes] = await Promise.all([
      db
        .from("events")
        .select("type, occurred_at")
        .eq("user_id", user.sub)
        .gte("occurred_at", since.toISOString())
        .order("occurred_at", { ascending: false })
        .limit(10000),
      db
        .from("devices")
        .select("id, name, platform, app_version, last_seen_at")
        .eq("user_id", user.sub)
        .order("last_seen_at", { ascending: false, nullsFirst: false }),
    ]);
    if (eventsRes.error) throw new Error(eventsRes.error.message);
    if (devicesRes.error) throw new Error(devicesRes.error.message);

    // Aggregate: events per UTC day per type.
    const byDay = new Map<string, Record<string, number>>();
    for (const ev of eventsRes.data ?? []) {
      const day = (ev.occurred_at as string).slice(0, 10);
      const counts = byDay.get(day) ?? {};
      counts[ev.type as string] = (counts[ev.type as string] ?? 0) + 1;
      byDay.set(day, counts);
    }
    const eventsPerDay = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, counts }));

    const devices = (devicesRes.data ?? []).map((d) => ({
      deviceId: d.id,
      name: d.name,
      platform: d.platform,
      appVersion: d.app_version,
      lastSeenAt: d.last_seen_at,
    }));

    return json({
      since: since.toISOString(),
      until: until.toISOString(),
      eventsPerDay,
      devices,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
