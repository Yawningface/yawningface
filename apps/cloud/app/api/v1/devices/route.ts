import { requireAuth } from "@/lib/auth";
import { errorResponse, json, preflight } from "@/lib/cors";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const PLATFORMS = ["mac", "windows", "linux", "ios", "android", "extension"];
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function OPTIONS() {
  return preflight();
}

/**
 * POST /api/v1/devices with body { deviceId?, name, platform, appVersion? }
 * → { deviceId }
 *
 * Registers a device (no deviceId, or an unknown one) or refreshes an
 * existing one (name/platform/appVersion/last_seen_at).
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
    const { deviceId, name, platform, appVersion } = (body ?? {}) as {
      deviceId?: unknown;
      name?: unknown;
      platform?: unknown;
      appVersion?: unknown;
    };

    if (typeof name !== "string" || name.trim().length === 0) {
      return json({ error: "name is required" }, { status: 400 });
    }
    if (typeof platform !== "string" || !PLATFORMS.includes(platform)) {
      return json(
        { error: `platform must be one of: ${PLATFORMS.join(", ")}` },
        { status: 400 }
      );
    }
    if (deviceId !== undefined && (typeof deviceId !== "string" || !UUID_RE.test(deviceId))) {
      return json({ error: "deviceId must be a UUID" }, { status: 400 });
    }
    if (appVersion !== undefined && typeof appVersion !== "string") {
      return json({ error: "appVersion must be a string" }, { status: 400 });
    }

    const db = getDb();
    const now = new Date().toISOString();

    if (deviceId) {
      // Update if the device exists and belongs to this user…
      const { data: updated, error: updateError } = await db
        .from("devices")
        .update({
          name: name.trim(),
          platform,
          app_version: appVersion ?? null,
          last_seen_at: now,
        })
        .eq("id", deviceId)
        .eq("user_id", user.sub)
        .select("id")
        .maybeSingle();
      if (updateError) throw new Error(updateError.message);
      if (updated) {
        return json({ deviceId: updated.id });
      }
      // …otherwise fall through and register it as new (client keeps its id).
      const { data: inserted, error: insertError } = await db
        .from("devices")
        .insert({
          id: deviceId,
          user_id: user.sub,
          name: name.trim(),
          platform,
          app_version: appVersion ?? null,
          last_seen_at: now,
        })
        .select("id")
        .single();
      if (insertError) throw new Error(insertError.message);
      return json({ deviceId: inserted.id });
    }

    const { data, error } = await db
      .from("devices")
      .insert({
        user_id: user.sub,
        name: name.trim(),
        platform,
        app_version: appVersion ?? null,
        last_seen_at: now,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return json({ deviceId: data.id });
  } catch (err) {
    return errorResponse(err);
  }
}
