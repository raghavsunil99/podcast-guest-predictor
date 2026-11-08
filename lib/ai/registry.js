// AI provider configuration (database, or data/providers.json). API keys are stored encrypted (see secrets.js)
// or read from an environment variable; they are never returned to the browser.
import crypto from "crypto";
import gemini from "./providers/gemini.js";
import anthropic from "./providers/anthropic.js";
import { compatible, deepseek, openai } from "./providers/openai.js";
import ollama from "./providers/ollama.js";
import { decrypt, encrypt, keyHint } from "./secrets.js";
import { readDoc, writeDoc } from "../db.js";

// To add a provider: write an adapter with generate/listModels/classify and register it here.
export const ADAPTERS = { gemini, openai, anthropic, deepseek, ollama, compatible };

let queue = Promise.resolve();

function seed() {
  const list = [];
  if (process.env.GEMINI_API_KEY) {
    list.push({
      id: "gemini",
      type: "gemini",
      name: "Google Gemini",
      enabled: true,
      priority: 1,
      model: process.env.GEMINI_MODEL || gemini.defaultModel,
      fallbackModels: (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash-lite,gemini-3.8-flash").split(",").map((s) => s.trim()).filter(Boolean),
      keyEnv: "GEMINI_API_KEY",
      dailyLimit: null,
      warnAt: 80,
    });
  }
  return { providers: list };
}

async function readStore() {
  const s = await readDoc("providers", null);
  if (s) return s;
  const fresh = seed();
  await writeStore(fresh);
  return fresh;
}
const writeStore = (s) => writeDoc("providers", s, { secret: true });
function withStore(fn) {
  const run = queue.then(async () => {
    const s = await readStore();
    const out = await fn(s);
    if (out?.save) await writeStore(s);
    return out?.value;
  });
  queue = run.catch(() => {});
  return run;
}

const sorted = (list) => [...list].sort((a, b) => a.priority - b.priority);
function renumber(list) {
  sorted(list).forEach((p, i) => (p.priority = i + 1));
}

export async function getProviders() {
  return sorted((await withStore((s) => ({ value: s.providers }))) || []);
}

export async function resolveKey(p) {
  if (p.keyEnc) return decrypt(p.keyEnc);
  if (p.keyEnv) return process.env[p.keyEnv] || "";
  return "";
}

// Safe view for the browser.
export function publicView(p) {
  const a = ADAPTERS[p.type];
  const { keyEnc, ...rest } = p; // eslint-disable-line no-unused-vars
  return {
    ...rest,
    typeLabel: a?.label || p.type,
    capabilities: a?.capabilities || {},
    suggestedModels: a?.suggestedModels || [],
    keyUrl: a?.keyUrl || "",
    hasKey: a?.needsKey === false || !!(p.keyEnc || (p.keyEnv && process.env[p.keyEnv])),
    keySource: a?.needsKey === false ? "none-needed" : p.keyEnc ? "encrypted" : p.keyEnv ? (process.env[p.keyEnv] ? `env:${p.keyEnv}` : "missing") : "missing",
    needsKey: a?.needsKey !== false,
  };
}

export function addProvider(input) {
  return withStore(async (s) => {
    const a = ADAPTERS[input.type];
    if (!a) throw new Error("Unknown provider type.");
    if (input.type === "compatible" && !input.baseUrl) throw new Error("Add the API base URL for an OpenAI-compatible provider.");
    const key = String(input.apiKey || "").trim();
    if (!key && a.needsKey !== false) throw new Error("Add an API key.");
    const p = {
      id: `${input.type}-${crypto.randomBytes(3).toString("hex")}`,
      type: input.type,
      name: String(input.name || a.label).slice(0, 60),
      enabled: true,
      priority: s.providers.length + 1,
      model: String(input.model || a.defaultModel || "").trim(),
      fallbackModels: [],
      baseUrl: input.baseUrl ? String(input.baseUrl).trim() : a.defaultBaseUrl || "",
      ...(key ? { keyEnc: await encrypt(key), keyHint: keyHint(key) } : {}),
      dailyLimit: input.dailyLimit ? Number(input.dailyLimit) : null,
      warnAt: 80,
    };
    s.providers.push(p);
    return { save: true, value: p };
  });
}

export function updateProvider(id, patch) {
  return withStore(async (s) => {
    const p = s.providers.find((x) => x.id === id);
    if (!p) return { value: null };
    for (const k of ["name", "model", "baseUrl"]) if (k in patch) p[k] = String(patch[k] || "").trim();
    if ("enabled" in patch) p.enabled = !!patch.enabled;
    if ("fallbackModels" in patch) p.fallbackModels = (Array.isArray(patch.fallbackModels) ? patch.fallbackModels : String(patch.fallbackModels).split(",")).map((m) => String(m).trim()).filter(Boolean);
    if ("dailyLimit" in patch) p.dailyLimit = patch.dailyLimit ? Math.max(1, Number(patch.dailyLimit)) : null;
    if ("warnAt" in patch) p.warnAt = Math.min(100, Math.max(1, Number(patch.warnAt) || 80));
    if (patch.apiKey) {
      const k = String(patch.apiKey).trim();
      p.keyEnc = await encrypt(k);
      p.keyHint = keyHint(k);
      delete p.keyEnv;
    }
    if (patch.move === "top") p.priority = 0;
    if (patch.move === "up") {
      const above = sorted(s.providers).filter((x) => x.priority < p.priority).pop();
      if (above) [above.priority, p.priority] = [p.priority, above.priority];
    }
    if (patch.move === "down") {
      const below = sorted(s.providers).find((x) => x.priority > p.priority);
      if (below) [below.priority, p.priority] = [p.priority, below.priority];
    }
    renumber(s.providers);
    return { save: true, value: p };
  });
}

export function removeProvider(id) {
  return withStore((s) => {
    const before = s.providers.length;
    s.providers = s.providers.filter((p) => p.id !== id);
    renumber(s.providers);
    return { save: s.providers.length !== before, value: s.providers.length !== before };
  });
}
