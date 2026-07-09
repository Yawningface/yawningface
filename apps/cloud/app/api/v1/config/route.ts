import { requireAuth } from "@/lib/auth";
import { errorResponse, json, preflight } from "@/lib/cors";
import { getDb } from "@/lib/db";
import { defaultConfig, validateConfig } from "@/lib/schema";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * GET /api/v1/config → { config, updatedAt }
 * Creates and returns a sensible default config if the user has none yet.
 */
export async function GET(req: Request) {
  try {
    const user = await requireAuth(req);
    const db = getDb();

    const { data, error } = await db
      .from("configs")
      .select("config, updated_at")
      .eq("user_id", user.sub)
      .maybeSingle();
    if (error) throw new Error(error.message);

    if (data) {
      return json({ config: data.config, updatedAt: data.updated_at });
    }

    // First fetch for this user: persist and return the default config.
    const config = defaultConfig();
    const { data: created, error: insertError } = await db
      .from("configs")
      .upsert(
        { user_id: user.sub, config, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      )
      .select("config, updated_at")
      .single();
    if (insertError) throw new Error(insertError.message);

    return json({ config: created.config, updatedAt: created.updated_at });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * PUT /api/v1/config with body { config } → { config, updatedAt }
 * Minimal shape validation, then upsert (last write wins).
 */
export async function PUT(req: Request) {
  try {
    const user = await requireAuth(req);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body must be valid JSON" }, { status: 400 });
    }
    const config = (body as { config?: unknown } | null)?.config;
    if (config === undefined) {
      return json({ error: "Body must be { config: … }" }, { status: 400 });
    }
    const problem = validateConfig(config);
    if (problem) {
      return json({ error: problem }, { status: 400 });
    }

    const { data, error } = await getDb()
      .from("configs")
      .upsert(
        { user_id: user.sub, config, updated_at: new Date().toISOString() },
        { onConflict: "user_id" }
      )
      .select("config, updated_at")
      .single();
    if (error) throw new Error(error.message);

    return json({ config: data.config, updatedAt: data.updated_at });
  } catch (err) {
    return errorResponse(err);
  }
}
