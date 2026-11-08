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

export function recordUsage({ model, kind, ok, usage, error }) {
  const entry = {
    t: new Date().toISOString(),
    day: pacificDay(),
    model,
    kind, // "generate" | "research"
    ok,
    input: usage?.promptTokenCount || 0,
    output: (usage?.candidatesTokenCount || 0) + (usage?.thoughtsTokenCount || 0),
    total: usage?.totalTokenCount || 0,
    ...(error ? { error: String(error).slice(0, 80) } : {}),
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
  const out = { calls: 0, successful: 0, failed: 0, input: 0, output: 0, total: 0, invitations: 0 };
  for (const e of list) {
    out.calls++;
    e.ok ? out.successful++ : out.failed++;
    if (e.ok && e.kind === "generate") out.invitations++;
    out.input += e.input;
    out.output += e.output;
    out.total += e.total;
  }
  return out;
}

export async function getUsageSummary() {
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

  return {
    today,
    resetsAt: "Midnight Pacific time (12:30 PM IST)",
    todayTotals: sum(todayEntries),
    todayByModel: Object.fromEntries(Object.entries(byModel).map(([m, l]) => [m, sum(l)])),
    last7Days: days,
    monthTotals: sum(all.filter((e) => e.day.startsWith(month))),
    allTime: sum(all),
    since: all[0]?.t || null,
  };
}
