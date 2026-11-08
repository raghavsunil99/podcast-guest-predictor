// Live health of each provider: last success, last error, cool-down after rate limits, and the
// latest rate-limit headers the provider sent back. Kept in data/provider-status.json.
import { readDoc, writeDoc } from "../db";

let state = null;
let writing = Promise.resolve();

async function load() {
  if (state) return state;
  state = (await readDoc("provider-status", {}).catch(() => ({}))) || {};
  return state;
}
function persist() {
  writing = writing
    .then(() => writeDoc("provider-status", state))
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
