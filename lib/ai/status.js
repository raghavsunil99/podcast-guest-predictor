// Live health of each provider: last success, last error, cool-down after rate limits, and the
// latest rate-limit headers the provider sent back. Kept in data/provider-status.json.
import { promises as fs } from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "provider-status.json");

let state = null;
let writing = Promise.resolve();

async function load() {
  if (state) return state;
  try {
    state = JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    state = {};
  }
  return state;
}
function persist() {
  writing = writing
    .then(async () => {
      await fs.mkdir(path.dirname(FILE), { recursive: true });
      await fs.writeFile(FILE, JSON.stringify(state));
    })
    .catch(() => {});
}

const COOLDOWN_MS = { rate: 2 * 60_000, quota: 30 * 60_000 };

export async function getStatus() {
  return { ...(await load()) };
}

export async function markOk(id, model, rateLimit) {
  const s = await load();
  const cur = s[id] || {};
  s[id] = { ...cur, lastOkAt: new Date().toISOString(), lastModel: model, cooldownUntil: null, authFailed: false };
  if (rateLimit && Object.values(rateLimit).some((v) => v != null)) s[id].rateLimit = { ...rateLimit, at: new Date().toISOString() };
  persist();
}

export async function markError(id, model, c) {
  const s = await load();
  const cur = s[id] || {};
  s[id] = {
    ...cur,
    lastError: { type: c.type, message: c.message, status: c.status, model, at: new Date().toISOString() },
    authFailed: c.type === "auth" ? true : cur.authFailed,
    cooldownUntil: COOLDOWN_MS[c.type] ? new Date(Date.now() + COOLDOWN_MS[c.type]).toISOString() : cur.cooldownUntil,
  };
  persist();
}

export const coolingDown = (st) => !!st?.cooldownUntil && new Date(st.cooldownUntil).getTime() > Date.now();
