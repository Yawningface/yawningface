export interface CoachEndpoint {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Defaults point at OpenRouter's free tier, so a $0 key from openrouter.ai
 * is enough to run the coach. Any OpenAI-compatible endpoint works.
 * (OPENCODE_* names are honoured as fallbacks for older setups.)
 */
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

/** Resolve the endpoint from the environment, or explain what's missing. */
export function endpointFromEnv(): CoachEndpoint | string {
  const apiKey = process.env.YF_COACH_API_KEY || process.env.OPENCODE_API_KEY;
  if (!apiKey) {
    return [
      "the coach is opt-in and needs a model API key.",
      "  Set YF_COACH_API_KEY in your environment or in a .env file.",
      "  Any OpenAI-compatible endpoint works — and the default model is",
      "  free: a $0 key from openrouter.ai is enough (see .env.example).",
      '  Prefer no AI at all? "yf init" and editing the JSON work fully offline.',
    ].join("\n");
  }
  return {
    apiKey,
    baseUrl: (
      process.env.YF_COACH_BASE_URL ??
      process.env.OPENCODE_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/+$/, ""),
    model: process.env.YF_COACH_MODEL ?? process.env.OPENCODE_MODEL ?? DEFAULT_MODEL,
  };
}

function parseErrorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; metadata?: { raw?: string } };
    };
    return parsed.error?.metadata?.raw ?? parsed.error?.message ?? body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One non-streaming chat completion against an OpenAI-compatible endpoint.
 * Free-tier models get congested; 429s are retried politely (up to twice,
 * honouring Retry-After) before giving up with a clear message.
 */
export async function chatComplete(
  endpoint: CoachEndpoint,
  messages: ChatMessage[],
): Promise<string> {
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    let response: Response;
    try {
      response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${endpoint.apiKey}`,
          // OpenRouter attribution (inert on other providers).
          "http-referer": "https://github.com/Yawningface/yawningface",
          "x-title": "YawningFace Coach",
        },
        body: JSON.stringify({ model: endpoint.model, messages, temperature: 0.4 }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(
        `could not reach ${endpoint.baseUrl} — are you offline? (${(error as Error).message})`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 429 && attempt < maxAttempts) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5000, 20_000);
      console.error(`  (model is busy — retrying in ${Math.round(waitMs / 1000)}s, attempt ${attempt + 1}/${maxAttempts})`);
      await response.text().catch(() => "");
      await sleep(waitMs);
      continue;
    }

    if (!response.ok) {
      const detail = parseErrorDetail(await response.text());
      if (response.status === 401 || response.status === 403) {
        throw new Error(`the endpoint refused the request (check YF_COACH_API_KEY): ${detail}`);
      }
      if (response.status === 429) {
        throw new Error(
          `the model stayed rate-limited after ${maxAttempts} attempts: ${detail}\n  (free models get congested — try again in a minute, or set YF_COACH_MODEL to another one)`,
        );
      }
      throw new Error(`endpoint returned HTTP ${response.status}: ${detail}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("endpoint returned an empty reply");
    }
    return content;
  }
}
