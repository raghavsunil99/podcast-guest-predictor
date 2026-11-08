// OpenAI and OpenAI-compatible APIs (DeepSeek, OpenRouter, Groq, Together, local servers…).
import OpenAI from "openai";
import { strictSchema } from "../schema";

function rateLimitFrom(h) {
  const n = (k) => (h.get(k) != null ? Number(h.get(k)) : undefined);
  return {
    requestsRemaining: n("x-ratelimit-remaining-requests"),
    requestsLimit: n("x-ratelimit-limit-requests"),
    tokensRemaining: n("x-ratelimit-remaining-tokens"),
    tokensLimit: n("x-ratelimit-limit-tokens"),
    resetAt: h.get("x-ratelimit-reset-requests") || undefined,
  };
}

function make({ type, label, defaultModel, suggestedModels, baseUrl, strict, pdf, keyUrl }) {
  return {
    type,
    label,
    defaultModel,
    suggestedModels,
    defaultBaseUrl: baseUrl,
    capabilities: { pdf, web: false, schema: true },
    keyUrl,

    async generate({ apiKey, baseUrl: custom, model, system, parts, schema, temperature }) {
      const client = new OpenAI({ apiKey, baseURL: custom || baseUrl, maxRetries: 0, timeout: 90_000 });
      const content = parts.map((p) =>
        p.pdf
          ? { type: "file", file: { filename: "profile.pdf", file_data: `data:application/pdf;base64,${p.pdf}` } }
          : { type: "text", text: p.text }
      );
      let sys = system || "";
      const body = { model, messages: [] };
      if (schema && strict) {
        body.response_format = { type: "json_schema", json_schema: { name: "result", strict: true, schema: strictSchema(schema) } };
      } else if (schema) {
        // No schema mode: ask for JSON and describe the shape.
        body.response_format = { type: "json_object" };
        sys += `\n\nRespond with a single JSON object only, matching this JSON Schema:\n${JSON.stringify(schema)}`;
      }
      if (sys) body.messages.push({ role: "system", content: sys });
      body.messages.push({ role: "user", content: strict ? content : parts.map((p) => p.text).filter(Boolean).join("\n\n") });
      if (typeof temperature === "number" && type !== "openai") body.temperature = temperature;

      const { data, response } = await client.chat.completions.create(body).withResponse();
      const u = data.usage || {};
      return {
        text: data.choices?.[0]?.message?.content || "",
        usage: { input: u.prompt_tokens || 0, output: u.completion_tokens || 0, total: u.total_tokens || 0 },
        rateLimit: rateLimitFrom(response.headers),
      };
    },

    async listModels({ apiKey, baseUrl: custom }) {
      const client = new OpenAI({ apiKey, baseURL: custom || baseUrl, maxRetries: 0, timeout: 20_000 });
      const out = [];
      for await (const m of client.models.list()) out.push(m.id);
      return out.sort();
    },

    classify(err) {
      const status = err?.status;
      const code = err?.code || err?.error?.code;
      if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) return { type: "auth", status, message: "API key rejected" };
      if (status === 402 || code === "insufficient_quota") return { type: "quota", status, message: "Quota or balance used up" };
      if (err instanceof OpenAI.RateLimitError) return { type: "rate", status: 429, message: "Rate limit reached" };
      if (err instanceof OpenAI.NotFoundError) return { type: "notfound", status: 404, message: "Model not available" };
      if (err instanceof OpenAI.APIConnectionError) return { type: "busy", status: null, message: "Connection failed or timed out" };
      if (status && status >= 500) return { type: "busy", status, message: "Provider busy" };
      if (status === 400 || status === 422) return { type: "bad", status, message: String(err?.message).slice(0, 160) };
      return { type: "other", status: status || null, message: String(err?.message || err).slice(0, 160) };
    },
  };
}

export const openai = make({
  type: "openai",
  label: "OpenAI",
  defaultModel: "gpt-5-mini",
  suggestedModels: ["gpt-5-mini", "gpt-5", "gpt-5-nano"],
  baseUrl: undefined,
  strict: true,
  pdf: true,
  keyUrl: "https://platform.openai.com/api-keys",
});

export const deepseek = make({
  type: "deepseek",
  label: "DeepSeek",
  defaultModel: "deepseek-chat",
  suggestedModels: ["deepseek-chat", "deepseek-reasoner"],
  baseUrl: "https://api.deepseek.com",
  strict: false,
  pdf: false,
  keyUrl: "https://platform.deepseek.com/api_keys",
});

export const compatible = make({
  type: "compatible",
  label: "Other (OpenAI-compatible)",
  defaultModel: "",
  suggestedModels: [],
  baseUrl: undefined,
  strict: false,
  pdf: false,
  keyUrl: "",
});
