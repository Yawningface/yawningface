export interface CoachEndpoint {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Resolve the endpoint from the environment, or explain what's missing. */
export function endpointFromEnv(): CoachEndpoint | string {
  const apiKey = process.env.OPENCODE_API_KEY;
  if (!apiKey) {
    return [
      "the coach is opt-in and needs a model API key.",
      "  Set OPENCODE_API_KEY in your environment or in a .env file",
      "  (any OpenAI-compatible endpoint works — see .env.example).",
      "  Prefer no AI at all? \"yf init\" and editing the JSON work fully offline.",
    ].join("\n");
  }
  return {
    apiKey,
    baseUrl: (process.env.OPENCODE_BASE_URL ?? "https://opencode.ai/zen/v1").replace(/\/+$/, ""),
    model: process.env.OPENCODE_MODEL ?? "claude-sonnet-5",
  };
}

/** One non-streaming chat completion against an OpenAI-compatible endpoint. */
export async function chatComplete(
  endpoint: CoachEndpoint,
  messages: ChatMessage[],
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  let response: Response;
  try {
    response = await fetch(`${endpoint.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${endpoint.apiKey}`,
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

  if (!response.ok) {
    const body = await response.text();
    let detail = body.slice(0, 300);
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      // keep the raw body
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`the endpoint refused the request (check OPENCODE_API_KEY): ${detail}`);
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
