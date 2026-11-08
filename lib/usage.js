// Tracks every Gemini call this app makes, in data/usage.json (kept on this computer).
// Google doesn't offer an API that reports remaining quota, so we count calls ourselves.
// "Today" follows Pacific time, because Gemini's daily limits reset at midnight Pacific.
import { promises as fs } from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "usage.json");
const MAX_ENTRIES = 20000;

let queue = Promise.resolve();

async function readAll() {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return [];
  }
}

export function pacificDay(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d); // YYYY-MM-DD
}

// usage: { input, output, total } (provider-neutral token counts)
export function recordUsage({ provider = "gemini", providerType = "gemini", model, kind, ok, usage, error, errorType }) {
  const entry = {
    t: new Date().toISOString(),
    day: pacificDay(),
    provider,
    providerType,
    model,
    kind, // generate | research | recommend | enrich | test
    ok,
    input: usage?.input || 0,
    output: usage?.output || 0,
    total: usage?.total || 0,
    ...(errorType ? { errorType } : {}),
    ...(error ? { error: String(error).slice(0, 120) } : {}),
  };
  // Serialize writes so parallel requests don't clobber each other.
  queue = queue
    .then(async () => {
      const all = await readAll();
      all.push(entry);
      await fs.mkdir(path.dirname(FILE), { recursive: true });
      await fs.writeFile(FILE, JSON.stringify(all.slice(-MAX_ENTRIES)));
    })
    .catch((e) => console.error("[usage] write failed", e));
  return entry;
}

function sum(list) {
  const out = { calls: 0, successful: 0, failed: 0, input: 0, output: 0, total: 0, invitations: 0, errors: {} };
  for (const e of list) {
    out.calls++;
    e.ok ? out.successful++ : out.failed++;
    if (!e.ok) out.errors[e.errorType || "other"] = (out.errors[e.errorType || "other"] || 0) + 1;
    if (e.ok && e.kind === "generate") out.invitations++;
    out.input += e.input;
    out.output += e.output;
    out.total += e.total;
  }
  return out;
}

// providers: [{ id, name, dailyLimit, warnAt }] from the registry, for per-provider limits and alerts.
export async function getUsageSummary(providers = []) {
  await queue;
  const all = await readAll();
  const today = pacificDay();
  const month = today.slice(0, 7);

  const todayEntries = all.filter((e) => e.day === today);
  const byModel = {};
  for (const e of todayEntries) (byModel[e.model] ||= []).push(e);

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = pacificDay(new Date(Date.now() - i * 86400000));
    days.push({ day: d, ...sum(all.filter((e) => e.day === d)) });
  }

  const prov = (e) => e.provider || "gemini"; // entries before v2.1 were all Gemini
  const byProvider = {};
  for (const p of providers) {
    const mine = all.filter((e) => prov(e) === p.id);
    const t = sum(mine.filter((e) => e.day === today));
    const lastErr = [...mine].reverse().find((e) => !e.ok);
    byProvider[p.id] = {
      today: t,
      month: sum(mine.filter((e) => e.day.startsWith(month))),
      lastError: lastErr ? { at: lastErr.t, type: lastErr.errorType || "other", message: lastErr.error || "" } : null,
      limit: p.dailyLimit || null,
      pct: p.dailyLimit ? Math.round((t.calls / p.dailyLimit) * 100) : null,
    };
  }
  const alerts = providers
    .filter((p) => p.dailyLimit && byProvider[p.id] && byProvider[p.id].today.calls >= (p.dailyLimit * (p.warnAt || 80)) / 100)
    .map((p) => ({ providerId: p.id, name: p.name, used: byProvider[p.id].today.calls, limit: p.dailyLimit, pct: byProvider[p.id].pct }));

  return {
    today,
    byProvider,
    alerts,
    resetsAt: "Midnight Pacific time (12:30 PM IST)",
    todayTotals: sum(todayEntries),
    todayByModel: Object.fromEntries(Object.entries(byModel).map(([m, l]) => [m, sum(l)])),
    last7Days: days,
    monthTotals: sum(all.filter((e) => e.day.startsWith(month))),
    allTime: sum(all),
    since: all[0]?.t || null,
  };
}
