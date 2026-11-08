import Anthropic from "@anthropic-ai/sdk";
import { strictSchema } from "../schema";

// Models that accept server-side refusal fallbacks (re-run on another Claude model if declined).
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

function rateLimitFrom(h) {
  const n = (k) => (h.get(k) != null ? Number(h.get(k)) : undefined);
  return {
    requestsRemaining: n("anthropic-ratelimit-requests-remaining"),
    requestsLimit: n("anthropic-ratelimit-requests-limit"),
    tokensRemaining: n("anthropic-ratelimit-tokens-remaining"),
    tokensLimit: n("anthropic-ratelimit-tokens-limit"),
    resetAt: h.get("anthropic-ratelimit-requests-reset") || undefined,
  };
}

export default {
  type: "anthropic",
  label: "Anthropic Claude",
  defaultModel: "claude-opus-5-5",
  suggestedModels: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
  capabilities: { pdf: true, web: false, schema: true },
  keyUrl: "https://platform.claude.com/settings/keys",

  async generate({ apiKey, model, system, parts, schema }) {
    // We switch providers ourselves, so the SDK shouldn't spend time retrying.
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 90_000 });
    const content = parts.map((p) =>
      p.pdf
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.pdf } }
        : { type: "text", text: p.text }
    );
    const params = {
      model,
      max_tokens: 16000,
      messages: [{ role: "user", content }],
      output_config: { effort: "low", ...(schema ? { format: { type: "json_schema", schema: strictSchema(schema) } } : {}) },
    };
    if (system) params.system = system;

    const useFallbacks = FALLBACK_MODELS.has(model);
    const call = useFallbacks
      ? client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
      : client.messages.create(params);
    const { data, response } = await call.withResponse();

    if (data.stop_reason === "refusal") {
      const e = new Error(`Claude declined the request${data.stop_details?.category ? ` (${data.stop_details.category})` : ""}.`);
      e.refusal = true;
      throw e;
    }
    const text = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const u = data.usage || {};
    const input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    return { text, usage: { input, output: u.output_tokens || 0, total: input + (u.output_tokens || 0) }, rateLimit: rateLimitFrom(response.headers) };
  },

  async listModels({ apiKey }) {
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 20_000 });
    const out = [];
    for await (const m of client.models.list()) out.push(m.id);
    return out;
  },

  classify(err) {
    if (err?.refusal) return { type: "other", status: 200, message: err.message };
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return { type: "auth", status: err.status, message: "API key rejected" };
    if (err instanceof Anthropic.RateLimitError) return { type: "rate", status: 429, message: "Rate limit reached" };
    if (err instanceof Anthropic.NotFoundError) return { type: "notfound", status: 404, message: "Model not available" };
    if (err instanceof Anthropic.APIConnectionError) return { type: "busy", status: null, message: "Connection failed or timed out" };
    if (err instanceof Anthropic.APIError) {
      if (err.type === "billing_error" || err.status === 402) return { type: "quota", status: err.status, message: "Billing or credit limit reached" };
      if (err.type === "overloaded_error" || (err.status && err.status >= 500)) return { type: "busy", status: err.status, message: "Claude is overloaded" };
      if (err.status === 400) return { type: "bad", status: 400, message: String(err.message).slice(0, 160) };
    }
    return { type: "other", status: err?.status || null, message: String(err?.message || err).slice(0, 160) };
  },
};
