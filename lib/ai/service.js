// Provider-independent AI service. Every feature calls runAI(); it walks the enabled providers
// in priority order and switches automatically on rate limits, quota, overload or timeouts.
// It never switches silently on an invalid key: that stops the request and tells the user.
import { ADAPTERS, getProviders, resolveKey } from "./registry.js";
import { coolingDown, getStatus, markError, markOk } from "./status.js";
import { parseJSON } from "./schema.js";
import { recordUsage } from "../usage.js";
import { pdfToText } from "../pdfText.js";

export class AIError extends Error {
  constructor(code, message, attempts = [], provider = null) {
    super(message);
    this.code = code; // auth | none | exhausted
    this.attempts = attempts;
    this.provider = provider;
  }
}

const REASON = {
  rate: "hit its rate limit",
  quota: "ran out of quota",
  busy: "was busy or timed out",
  notfound: "doesn't have that model",
  bad: "rejected the request format",
  other: "failed",
};

/**
 * @param {object} o
 * @param {string} o.kind        usage label: generate | research | recommend | enrich | test
 * @param {string} [o.system]
 * @param {Array<{text?:string,pdf?:string}>} o.parts
 * @param {object} [o.schema]    JSON schema → result.data is parsed JSON
 * @param {object} [o.needs]     { pdf, web } capabilities the request requires
 * @param {string} [o.providerId] pin to one provider (manual switching); no cross-provider fallback
 */
export async function runAI({ kind, system, parts, schema, temperature, needs = {}, providerId }) {
  const all = await getProviders();
  const status = await getStatus();
  let chain = providerId ? all.filter((p) => p.id === providerId) : all.filter((p) => p.enabled);
  if (providerId && !chain.length) throw new AIError("none", "That AI provider no longer exists. Pick another in Settings → AI providers.");

  // Providers that can't read PDF files get the PDF's text instead (extracted once, on demand).
  let pdfTextCache;
  const pdfB64 = parts.find((x) => x.pdf)?.pdf;
  const getPdfText = async () => (pdfTextCache ??= pdfB64 ? await pdfToText(Buffer.from(pdfB64, "base64")) : "");
  const textCapable = (caps) => caps.pdfText || caps.schema;
  if (needs.pdf && chain.some((p) => !ADAPTERS[p.type]?.capabilities?.pdf)) await getPdfText();

  const missing = [];
  chain = chain.filter((p) => {
    const caps = ADAPTERS[p.type]?.capabilities || {};
    if (needs.pdf && !caps.pdf && !(pdfTextCache && textCapable(caps))) return missing.push(`${p.name} can't read this PDF`), false;
    if (needs.web && !caps.web) return missing.push(`${p.name} can't research URLs`), false;
    return true;
  });
  if (!chain.length) {
    const why = missing.length ? ` (${missing.join("; ")})` : "";
    throw new AIError("none", `No enabled AI provider can handle this request${why}. Add or enable one in Settings → AI providers.`);
  }
  // Providers cooling down after a rate limit go last, not out.
  if (!providerId) chain = [...chain.filter((p) => !coolingDown(status[p.id])), ...chain.filter((p) => coolingDown(status[p.id]))];

  const attempts = [];
  for (const p of chain) {
    const adapter = ADAPTERS[p.type];
    let apiKey = "";
    try {
      apiKey = await resolveKey(p);
    } catch {
      attempts.push({ provider: p.name, providerId: p.id, type: "auth", message: "Stored key can't be decrypted (APP_ENCRYPTION_KEY changed?)" });
      throw new AIError("auth", `${p.name}'s saved API key can't be read. Re-enter it in Settings → AI providers.`, attempts, p);
    }
    if (!apiKey && adapter.needsKey !== false) {
      attempts.push({ provider: p.name, providerId: p.id, type: "nokey", message: "No API key" });
      continue;
    }
    const models = [p.model || adapter.defaultModel, ...(p.fallbackModels || [])].filter((m, i, a) => m && a.indexOf(m) === i);
    let nextProvider = false;
    for (const model of models) {
      try {
        const useParts = adapter.capabilities?.pdf || !pdfB64
          ? parts
          : parts.map((x) => (x.pdf ? { text: `PROFILE (text extracted from the LinkedIn PDF):\n${pdfTextCache}` } : x));
        const out = await adapter.generate({ apiKey, baseUrl: p.baseUrl, model, system, parts: useParts, schema, temperature, web: !!needs.web });
        const data = schema ? parseJSON(out.text) : out.text;
        recordUsage({ provider: p.id, providerType: p.type, model, kind, ok: true, usage: out.usage });
        markOk(p.id, model, out.rateLimit);
        const switched = attempts.filter((a) => a.type !== "nokey");
        return {
          data,
          provider: { id: p.id, name: p.name, type: p.type },
          model,
          tokens: out.usage?.total || 0,
          attempts,
          notice: switched.length
            ? `${switched.map((a) => `${a.provider} ${REASON[a.type] || "failed"}`).filter((v, i, arr) => arr.indexOf(v) === i).join("; ")}, so ${p.name} answered instead.`
            : "",
        };
      } catch (err) {
        const c = err?.message?.includes("valid JSON") ? { type: "bad", status: null, message: "Reply was not valid JSON" } : adapter.classify(err);
        recordUsage({ provider: p.id, providerType: p.type, model, kind, ok: false, errorType: c.type, error: c.message });
        markError(p.id, model, c);
        attempts.push({ provider: p.name, providerId: p.id, model, type: c.type, message: c.message });
        console.warn(`[ai] ${p.name}/${model} → ${c.type}: ${c.message}`);
        if (c.type === "auth") {
          throw new AIError(
            "auth",
            `${p.name} rejected its API key, so the request was stopped instead of quietly switching providers. Update the key in Settings → AI providers, disable ${p.name}, or pick another provider for this request.`,
            attempts,
            p
          );
        }
        // Limits are usually per model, so try this provider's backup models first, then the next provider.
        if (["busy", "notfound", "rate", "quota"].includes(c.type)) continue;
        nextProvider = true;
        break; // bad request / other → next provider
      }
    }
    if (nextProvider) continue;
  }

  if (attempts.every((a) => a.type === "nokey")) {
    throw new AIError("none", "No API key is set for the enabled providers. Add one in Settings → AI providers.", attempts);
  }
  const summary = attempts.filter((a) => a.type !== "nokey").map((a) => `${a.provider}${a.model ? ` (${a.model})` : ""}: ${REASON[a.type] || a.message}`);
  throw new AIError("exhausted", `Every AI provider tried is unavailable right now. ${[...new Set(summary)].join(" · ")}. Wait a minute and try again, or add another provider in Settings.`, attempts);
}

export function aiErrorResponse(err) {
  if (err instanceof AIError) {
    const status = err.code === "auth" ? 401 : err.code === "none" ? 400 : 503;
    return Response.json({ error: err.message, code: err.code, attempts: err.attempts, providerId: err.provider?.id }, { status });
  }
  console.error(err);
  return Response.json({ error: "AI request failed: " + String(err?.message || err).slice(0, 300) }, { status: 502 });
}

export async function testProvider(p) {
  const adapter = ADAPTERS[p.type];
  const t0 = Date.now();
  const model = p.model || adapter.defaultModel;
  try {
    const apiKey = await resolveKey(p);
    if (!apiKey && adapter.needsKey !== false) return { ok: false, type: "nokey", message: "No API key set" };
    const out = await adapter.generate({
      apiKey,
      baseUrl: p.baseUrl,
      model,
      parts: [{ text: 'Connectivity check. Reply with {"ok": true}.' }],
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    });
    parseJSON(out.text);
    recordUsage({ provider: p.id, providerType: p.type, model, kind: "test", ok: true, usage: out.usage });
    markOk(p.id, model, out.rateLimit);
    return { ok: true, model, latencyMs: Date.now() - t0, rateLimit: out.rateLimit || null };
  } catch (err) {
    const c = adapter.classify(err);
    recordUsage({ provider: p.id, providerType: p.type, model, kind: "test", ok: false, errorType: c.type, error: c.message });
    markError(p.id, model, c);
    return { ok: false, model, latencyMs: Date.now() - t0, type: c.type, message: c.message };
  }
}
