// The overall acceptance score is computed here, from per-criterion scores (0–10), so the
// weighting is fixed and visible in the UI rather than a number the model makes up.
export const CRITERIA = [
  { id: "audience", label: "LinkedIn audience", weight: 20, what: "Followers and connections" },
  { id: "posting", label: "Posting activity", weight: 20, what: "How often they post or share on LinkedIn" },
  { id: "speaking", label: "Public speaking & content", weight: 20, what: "Talks, webinars, podcasts, YouTube, blogs" },
  { id: "mentoring", label: "Mentoring & helping students", weight: 15, what: "Topmate/ADPList, teaching, community work" },
  { id: "story", label: "Story fit for students", weight: 15, what: "How relatable and inspiring their journey is" },
  { id: "accessibility", label: "Reachability", weight: 10, what: "Seniority, availability, recent job change" },
];

export function scoreAcceptance(data) {
  const acc = data.acceptance || {};
  const given = Object.fromEntries((acc.criteria || []).map((c) => [c.id, c]));
  acc.criteria = CRITERIA.map((c) => {
    const g = given[c.id] || { score: 5, evidence: "Not shown in the profile", found: false };
    const score = Math.max(0, Math.min(10, Math.round(Number(g.score) || 0)));
    return { ...c, score, evidence: g.evidence, found: g.found !== false, points: Math.round((score / 10) * c.weight * 10) / 10 };
  });
  acc.score = Math.round(acc.criteria.reduce((t, c) => t + c.points, 0));
  acc.likelihood = acc.score >= 65 ? "High" : acc.score >= 45 ? "Medium" : "Low";
  acc.dataCoverage = acc.criteria.filter((c) => c.found).length;
  data.acceptance = acc;
}

// ---------- Signals you add by hand (when the profile text didn't show them) ----------
export function parseCount(s) {
  const t = String(s || "").toLowerCase().replace(/,/g, "");
  const m = t.match(/(\d+(?:\.\d+)?)\s*(k|m)?/);
  if (!m) return null;
  return Math.round(Number(m[1]) * (m[2] === "k" ? 1000 : m[2] === "m" ? 1e6 : 1));
}
function audienceScore(followers, connections) {
  const f = parseCount(followers);
  const c = parseCount(connections);
  if (f != null) return f >= 10000 ? 10 : f >= 5000 ? 8 : f >= 2000 ? 7 : f >= 1000 ? 6 : f >= 500 ? 4 : 3;
  if (c != null) return c >= 500 ? 5 : 3;
  return null;
}
const POSTING = { Frequent: 9, Occasional: 6, Rare: 3 };
const SPEAKING = { Strong: 9, Some: 6, "None found": 3 };

/** Apply hand-entered signals to a saved result and recompute its score. */
export function applyManualSignals(result, sig) {
  const r = structuredClone(result);
  const ss = { ...(r.socialSignals || {}) };
  if (sig.followers != null) ss.followers = String(sig.followers).trim() || "Unknown";
  if (sig.connections != null) ss.connections = String(sig.connections).trim() || "Unknown";
  if (sig.postingActivity) ss.postingActivity = sig.postingActivity;
  if (sig.publicSpeaking) ss.publicSpeaking = sig.publicSpeaking;
  ss.manual = { ...(ss.manual || {}), ...Object.fromEntries(Object.keys(sig).map((k) => [k, true])) };
  r.socialSignals = ss;

  const acc = r.acceptance || { criteria: [] };
  const set = (id, score, evidence) => {
    const list = acc.criteria || [];
    const i = list.findIndex((c) => c.id === id);
    const v = { id, score, evidence, found: true };
    if (i >= 0) list[i] = { ...list[i], ...v };
    else list.push(v);
    acc.criteria = list;
  };
  const known = (v) => v && v !== "Unknown";
  if (sig.followers != null || sig.connections != null) {
    const a = audienceScore(known(ss.followers) ? ss.followers : "", known(ss.connections) ? ss.connections : "");
    if (a != null) set("audience", a, `Added by you: ${[known(ss.followers) && ss.followers, known(ss.connections) && ss.connections].filter(Boolean).join(", ")}`);
  }
  if (POSTING[sig.postingActivity]) set("posting", POSTING[sig.postingActivity], `Added by you: posts ${sig.postingActivity.toLowerCase()}`);
  if (SPEAKING[sig.publicSpeaking]) set("speaking", SPEAKING[sig.publicSpeaking], `Added by you: public speaking ${sig.publicSpeaking.toLowerCase()}`);
  r.acceptance = acc;
  scoreAcceptance(r);
  return r;
}
