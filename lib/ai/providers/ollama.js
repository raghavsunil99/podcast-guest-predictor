// Local models through Ollama (https://ollama.com): free, unlimited, runs on this computer.
// Uses Ollama's native /api/chat, whose `format` option constrains the reply to our JSON schema.
// No API key. PDFs are handled by sending the PDF's extracted text (see service.js).

const DEFAULT_URL = "http://127.0.0.1:11434";
const root = (baseUrl) => String(baseUrl || DEFAULT_URL).replace(/\/+$/, "").replace(/\/v1$/, "");

class OllamaError extends Error {
  constructor(message, status, kind) {
    super(message);
    this.status = status;
    this.kind = kind;
  }
}

async function call(baseUrl, pathname, body, timeoutMs) {
  let res;
  try {
    res = await fetch(`${root(baseUrl)}${pathname}`, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err?.name === "TimeoutError") throw new OllamaError("The local model took too long", null, "timeout");
    throw new OllamaError("Ollama isn't running. Open the Ollama app and try again.", null, "offline");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new OllamaError(data.error || `Ollama error ${res.status}`, res.status, res.status === 404 ? "notfound" : "other");
  return data;
}

export default {
  type: "ollama",
  label: "Ollama (local, free)",
  defaultModel: "qwen3:8b",
  suggestedModels: ["qwen3:8b", "gemma3:12b", "llama3.1:8b", "qwen3:4b"],
  defaultBaseUrl: DEFAULT_URL,
  needsKey: false,
  capabilities: { pdf: false, pdfText: true, web: false, schema: true, local: true },
  keyUrl: "https://ollama.com/download",

  async generate({ baseUrl, model, system, parts, schema, temperature }) {
    const user = parts.map((p) => p.text).filter(Boolean).join("\n\n");
    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: user });
    const data = await call(
      baseUrl,
      "/api/chat",
      {
        model,
        messages,
        stream: false,
        think: false, // reasoning models (e.g. Qwen3) answer much faster without a thinking pass
        ...(schema ? { format: schema } : {}),
        options: { temperature: typeof temperature === "number" ? temperature : 0.4, num_ctx: 16384 },
        keep_alive: "15m",
      },
      600_000 // local models are much slower than cloud APIs (a full profile can take 3–5 min)
    );
    const input = data.prompt_eval_count || 0;
    const output = data.eval_count || 0;
    return { text: data.message?.content || "", usage: { input, output, total: input + output } };
  },

  async listModels({ baseUrl }) {
    const data = await call(baseUrl, "/api/tags", null, 10_000);
    return (data.models || []).map((m) => m.name);
  },

  classify(err) {
    if (err?.kind === "offline") return { type: "busy", status: null, message: "Ollama isn't running" };
    if (err?.kind === "timeout") return { type: "busy", status: null, message: "Local model timed out" };
    if (err?.kind === "notfound" || /not found|pull/i.test(err?.message || "")) return { type: "notfound", status: 404, message: "Model not downloaded (run: ollama pull <model>)" };
    return { type: "other", status: err?.status || null, message: String(err?.message || err).slice(0, 160) };
  },
};
