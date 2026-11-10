import { GoogleGenAI } from "@google/genai";

export const RETRY_DELAYS = [4_000, 10_000];

// Full profile studies (PDF in, long JSON out) can take over a minute when Google is busy.
const client = (apiKey) => new GoogleGenAI({ apiKey, httpOptions: { timeout: 120_000, retryOptions: { attempts: 1 } } });

export default {
  type: "gemini",
  label: "Google Gemini",
  defaultModel: "gemini-3.5-flash",
  suggestedModels: ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.7-pro"],
  capabilities: { pdf: true, web: true, schema: true },
  keyUrl: "https://aistudio.google.com/apikey",

  async generate({ apiKey, model, system, parts, schema, temperature, web }) {
    const contents = [
      {
        role: "user",
        parts: parts.map((p) => (p.pdf ? { inlineData: { mimeType: "application/pdf", data: p.pdf } } : { text: p.text })),
      },
    ];
    const config = { thinkingConfig: { thinkingLevel: "LOW" } };
    if (system) config.systemInstruction = system;
    if (typeof temperature === "number") config.temperature = temperature;
    if (web) config.tools = [{ urlContext: {} }, { googleSearch: {} }];
    else if (schema) {
      config.responseMimeType = "application/json";
      config.responseJsonSchema = schema;
    }
    // Google answers 503 "high demand" during load spikes; these usually pass in seconds, so retry the
    // same model twice (after ~4s and ~10s) before letting the service fall back to the next one.
    let res;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await client(apiKey).models.generateContent({ model, contents, config });
        break;
      } catch (err) {
        const msg = String(err?.message || err);
        const overloaded = err?.status === 503 || /"code":\s*503|UNAVAILABLE|high demand|overloaded/i.test(msg);
        if (!overloaded || attempt >= RETRY_DELAYS.length) throw err;
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
      }
    }
    const u = res.usageMetadata || {};
    const output = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
    return { text: res.text || "", usage: { input: u.promptTokenCount || 0, output, total: u.totalTokenCount || 0 } };
  },

  async listModels({ apiKey }) {
    const out = [];
    const pager = await client(apiKey).models.list();
    for await (const m of pager) {
      if ((m.supportedActions || []).includes("generateContent")) out.push(String(m.name).replace(/^models\//, ""));
    }
    return out;
  },

  classify(err) {
    const msg = String(err?.message || err);
    const status = err?.status || Number(msg.match(/"code":\s*(\d{3})/)?.[1]) || null;
    if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID|PERMISSION_DENIED/i.test(msg)) return { type: "auth", status, message: "API key rejected" };
    if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) {
      // Gemini names the exhausted quota, e.g. GenerateRequestsPerMinutePerProjectPerModel vs ...PerDay...
      const daily = /PerDay/i.test(msg) && !/PerMinute/i.test(msg);
      return daily ? { type: "quota", status: 429, message: "Daily quota used up for this model" } : { type: "rate", status: 429, message: "Per-minute rate limit reached" };
    }
    if (status === 404 || /not found|no longer available/i.test(msg)) return { type: "notfound", status, message: "Model not available" };
    if ((status && status >= 500) || /UNAVAILABLE|DEADLINE|overloaded|high demand|INTERNAL|timed? ?out|abort/i.test(msg)) return { type: "busy", status, message: "Model busy or timed out" };
    if (status === 400) return { type: "bad", status, message: msg.slice(0, 160) };
    return { type: "other", status, message: msg.slice(0, 160) };
  },
};
