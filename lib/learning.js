// Outcome learning: adjusts each guest's AI profile score using what actually happened with
// earlier guests (accepted / recorded vs rejected / no reply). Fully explainable:
//   1. Trait evidence: for each trait (seniority, role family, experience, industry, expertise,
//      location, company, behavioural signals) compare the yes-rate of past guests with that
//      trait against the overall yes-rate (smoothed, so one guest can't swing it).
//   2. Nearest past guests: the outcomes of the most similar labelled guests, weighted by similarity.
// Company is just one low-weight trait among many, so a company's past "yes" doesn't lift
// everyone there. Native language and region are deliberately NOT used, to avoid regional bias.
import { companyKey, normText, reached, tierOf } from "./crm.js";

const TRAIT_WEIGHT = {
  seniority: 1.0,
  roleFamily: 1.0,
  experience: 0.7,
  industry: 0.7,
  expertise: 0.6,
  signal: 0.5,
  location: 0.25,
  company: 0.35,
  move: 0.7,
  college: 0.4,
  pastCompany: 0.3,
  growth: 0.4,
};
const MULTI = new Set(["expertise", "signal", "move", "pastCompany"]);
const TRAIT_LABEL = {
  seniority: "Seniority",
  roleFamily: "Role",
  experience: "Experience",
  industry: "Industry",
  expertise: "Expertise",
  signal: "Signal",
  location: "Location",
  company: "Company",
  move: "Career move",
  college: "College type",
  pastCompany: "Worked at",
  growth: "Growth",
};
const SIGNAL_LABEL = { audience: "LinkedIn audience", posting: "Posting activity", speaking: "Public speaking", mentoring: "Mentoring", story: "Story fit", accessibility: "Reachability" };

const MIN_LABELLED = 2; // below this, no adjustment
const FULL_CONFIDENCE_AT = 10; // labelled outcomes for full-strength adjustments
const MAX_ADJUST = 15;

export function seniority(role = "") {
  const r = role.toLowerCase();
  if (/\b(ceo|cto|cfo|coo|cpo|chief|founder|co-founder|president)\b/.test(r)) return "Founder / C-level";
  if (/\b(vp|vice president|head of|director)\b/.test(r)) return "Director / VP";
  if (/\b(manager|lead|principal|staff|architect)\b/.test(r)) return "Lead / Manager";
  if (/\b(senior|sr\.?|sde ?(iii|3)|specialist)\b/.test(r)) return "Senior";
  if (/\b(intern|trainee|fresher|junior|associate|graduate)\b/.test(r)) return "Early career";
  return role ? "Mid-level" : "";
}

export function roleFamily(role = "", domain = "") {
  const r = `${role} ${domain}`.toLowerCase();
  if (/\b(data|ml|machine learning|ai\b|analytics|analyst|scientist|nlp)\b/.test(r)) return "Data & AI";
  if (/\b(product manager|product owner|\bpm\b|product management)\b/.test(r)) return "Product";
  if (/\b(design|ux|ui)\b/.test(r)) return "Design";
  if (/\b(devops|sre|cloud|infra|platform|security|network)\b/.test(r)) return "Cloud & infra";
  if (/\b(engineer|engineering|tech lead|developer|sde|software|programmer|frontend|backend|full ?stack|qa|test)\b/.test(r)) return "Engineering";
  if (/\b(marketing|growth|brand|content|seo)\b/.test(r)) return "Marketing";
  if (/\b(sales|business development|account|customer success)\b/.test(r)) return "Sales & success";
  if (/\b(hr|talent|recruit|people)\b/.test(r)) return "People & HR";
  if (/\b(founder|entrepreneur)\b/.test(r)) return "Founder";
  if (/\b(teacher|trainer|faculty|professor|educator|mentor)\b/.test(r)) return "Education";
  return role ? "Other" : "";
}

export function experienceBucket(exp = "") {
  const n = parseFloat(String(exp).match(/\d+(\.\d+)?/)?.[0]);
  if (!Number.isFinite(n)) return "";
  if (n < 3) return "0–3 yrs";
  if (n < 6) return "3–6 yrs";
  if (n < 10) return "6–10 yrs";
  if (n < 15) return "10–15 yrs";
  return "15+ yrs";
}

const STOP = new Set(["and", "the", "for", "with", "development", "management", "engineering", "software", "skills", "solutions"]);
function expertise(g) {
  const terms = [g.domain, ...(g.skills || [])]
    .flatMap((s) => String(s || "").split(/[,/|&]+/))
    .map((s) => normText(s))
    .filter((s) => s.length > 1 && !STOP.has(s));
  return [...new Set(terms)].slice(0, 10);
}

// Each guest → list of [trait, value].
export function traits(g) {
  const out = [];
  const add = (t, v) => v && out.push([t, v]);
  add("seniority", seniority(g.role));
  add("roleFamily", roleFamily(g.role, g.domain));
  add("experience", experienceBucket(g.experience));
  add("industry", g.industry ? normText(g.industry) : "");
  add("location", g.city ? normText(g.city) : "");
  add("company", companyKey(g));
  for (const e of expertise(g)) add("expertise", e);
  for (const t of g.careerTags || []) {
    if (t === "Service → Product" || t === "Into Big Tech" || t === "Career switch") add("move", t);
  }
  if ((g.careerTags || []).some((t) => t.startsWith("Promoted"))) add("growth", "promoted within a company");
  const ct = (g.result?.profile?.education || []).map((e) => e.type).find((t) => t && !["School", "Other"].includes(t));
  add("college", ct || "");
  for (const c of (g.pastCompanies || []).slice(0, 6)) add("pastCompany", normText(c));
  for (const c of g.result?.acceptance?.criteria || []) {
    if (c.found) add("signal", `${c.id}:${c.score >= 7 ? "strong" : c.score <= 3 ? "weak" : "moderate"}`);
  }
  return out;
}

const pretty = (trait, value, g) => {
  if (trait === "signal") {
    const [id, lvl] = value.split(":");
    return `${lvl} ${SIGNAL_LABEL[id]?.toLowerCase() || id}`;
  }
  if (trait === "industry" || trait === "location") return g?.[trait === "industry" ? "industry" : "city"] || value;
  if (trait === "company") return g?.company || value;
  if (trait === "pastCompany") return (g?.pastCompanies || []).find((c) => normText(c) === value) || value;
  return value;
};

const DAY = 86400000;
export const SILENCE_DAYS = 7; // contacted this long with no reply starts to count as "no reply"

/** What happened with a guest, split into two questions:
 *   reply: did they reply at all? (1 / 0 / null)        → learns reachability
 *   yes:   once they replied, did they say yes? (1 / 0 / null) → learns fit
 *  y/w/label is the overall yes/no used for neighbours and the summary (w = how much to trust it). */
export function outcomeOf(g, now = Date.now()) {
  if (reached(g, "Accepted") || g.stage === "Recorded") return { y: 1, w: 1, reply: 1, yes: 1, rw: 1, label: g.stage === "Recorded" ? "Recorded" : "Accepted" };
  if (g.stage === "Rejected") return { y: 0, w: 1, reply: 1, yes: 0, rw: 1, label: "Rejected" };
  if (g.stage === "Not responded") return { y: 0, w: 0.6, reply: 0, yes: null, rw: 1, label: "Not responded" };
  if (g.stage === "Responded") return { y: null, w: 0, reply: 1, yes: null, rw: 1, label: "Replied, no decision yet" };
  if (g.stage === "Contacted") {
    const since = Date.parse(g.lastFollowUpAt || g.milestones?.Contacted || "");
    const days = Number.isFinite(since) ? (now - since) / DAY : 0;
    if (days >= SILENCE_DAYS) {
      // Silence grows into a "no reply": 0.3 after a week, 0.6 (same as marking Not responded) after two.
      const rw = Math.min(0.6, 0.3 + 0.3 * ((days - SILENCE_DAYS) / SILENCE_DAYS));
      return { y: 0, w: rw * 0.6, reply: 0, yes: null, rw, label: `No reply for ${Math.floor(days)} days` };
    }
    return null;
  }
  if (g.recFeedback === "relevant") return { y: 1, w: 0.3, reply: null, yes: null, rw: 0, label: "Marked relevant" };
  if (g.recFeedback === "irrelevant") return { y: 0, w: 0.3, reply: null, yes: null, rw: 0, label: "Marked not relevant" };
  return null;
}

// One table of trait counts for one question ("overall", "reply" or "yes").
function table(rows) {
  const counts = new Map();
  let pos = 0, neg = 0;
  for (const { t, y, w, id } of rows) {
    y ? (pos += w) : (neg += w);
    for (const [k, v] of t) {
      const key = `${k}|${v}`;
      const c = counts.get(key) || { pos: 0, neg: 0, posN: 0, negN: 0 };
      if (y) { c.pos += w; if (w >= 0.6) c.posN++; } else { c.neg += w; if (w >= 0.6) c.negN++; }
      counts.set(key, c);
    }
  }
  return { rows, counts, pos, neg, n: rows.length };
}

export function buildModel(guests, now = Date.now()) {
  const labelled = [];
  const all = [], reply = [], yes = [];
  for (const g of guests) {
    const o = outcomeOf(g, now);
    if (!o) continue;
    const t = traits(g);
    if (o.y != null && o.w > 0) { labelled.push({ g, o, t }); all.push({ id: g.id, t, y: o.y, w: o.w }); }
    if (o.reply != null) reply.push({ id: g.id, t, y: o.reply, w: o.rw });
    if (o.yes != null) yes.push({ id: g.id, t, y: o.yes, w: 1 });
  }
  const overall = table(all);
  const strong = labelled.filter((l) => l.o.w >= 0.6);
  return {
    labelled,
    counts: overall.counts,
    pos: overall.pos,
    neg: overall.neg,
    stages: { reply: table(reply), yes: table(yes) },
    outcomes: {
      yes: strong.filter((l) => l.o.y).length,
      no: strong.filter((l) => !l.o.y).length,
      noReply: reply.filter((r) => !r.y).length,
      rejected: yes.filter((r) => !r.y).length,
      replied: reply.filter((r) => r.y).length,
      feedback: labelled.length - strong.length,
    },
  };
}

const logit = (p) => Math.log(p / (1 - p));

function traitSimilarity(ta, tb) {
  let num = 0, den = 0;
  const byType = (t) => t.reduce((m, [k, v]) => ((m[k] ||= new Set()).add(v), m), {});
  const A = byType(ta), B = byType(tb);
  for (const [k, w] of Object.entries(TRAIT_WEIGHT)) {
    if (!A[k] || !B[k]) continue;
    den += w;
    const inter = [...A[k]].filter((v) => B[k].has(v)).length;
    num += w * (MULTI.has(k) ? inter / Math.max(A[k].size, B[k].size) : inter ? 1 : 0);
  }
  return den ? num / den : 0;
}
export function similarityTo(a, b) {
  return traitSimilarity(traits(a), traits(b));
}

// Smoothed trait evidence for one question, leaving the guest's own outcome out.
function stageEvidence(tab, t, selfId) {
  const self = tab.rows.find((r) => r.id === selfId);
  const pos = tab.pos - (self?.y ? self.w : 0);
  const neg = tab.neg - (self && !self.y ? self.w : 0);
  const n = tab.n - (self ? 1 : 0);
  if (n < 1 || pos + neg <= 0) return { n, p0: null, evidence: 0, contrib: [] };
  const p0 = (pos + 1) / (pos + neg + 2);
  const perType = {};
  for (const [k, v] of t) {
    const c = tab.counts.get(`${k}|${v}`);
    if (!c) continue;
    let cp = c.pos, cn = c.neg, pN = c.posN, nN = c.negN;
    if (self && self.t.some(([k2, v2]) => k2 === k && v2 === v)) {
      if (self.y) { cp -= self.w; if (self.w >= 0.6) pN--; } else { cn -= self.w; if (self.w >= 0.6) nN--; }
    }
    if (cp + cn <= 0) continue;
    const pv = (cp + 2 * p0) / (cp + cn + 2);
    const lift = logit(Math.min(0.99, Math.max(0.01, pv))) - logit(p0);
    (perType[k] ||= []).push({ k, v, lift, pN: Math.max(0, pN), nN: Math.max(0, nN) });
  }
  let evidence = 0, wsum = 0;
  const contrib = [];
  for (const [k, list] of Object.entries(perType)) {
    const w = TRAIT_WEIGHT[k] / (MULTI.has(k) ? Math.max(1, list.length) : 1);
    for (const x of list) { evidence += w * x.lift; contrib.push({ ...x, c: w * x.lift }); }
    wsum += TRAIT_WEIGHT[k];
  }
  // Traits overlap (role, seniority, expertise often say the same thing), so use a weighted
  // average with a mild boost for agreement rather than a raw sum.
  if (wsum) evidence = (evidence / wsum) * Math.sqrt(Object.keys(perType).length);
  // A question only has something to teach once both answers have been seen.
  const informative = pos > 0 && neg > 0;
  const balance = Math.min(1, Math.min(pos, neg) / MINORITY_FOR_FULL);
  return { n, p0, evidence: informative ? evidence * balance : 0, contrib: informative ? contrib : [], pos, neg, balance };
}

const MINORITY_FOR_FULL = 6; // full-strength learning once both answers have been seen ~6 times
const squash = (x, n) => Math.tanh(x / 1.2) * 1.2 * Math.min(1, n / FULL_CONFIDENCE_AT) ** 0.5;

/** Learned adjustment for one guest, with reasons. Leave-one-out: a guest's own outcome never
 *  counts towards its own score. */
export function scoreGuest(g, model) {
  const base = typeof g.score === "number" ? g.score : null;
  const n = model.labelled.filter((l) => l.g.id !== g.id).length;
  const out = { base, adjust: 0, reasons: [], neighbours: [], learnedFrom: n, active: false };
  if (base == null) return out;
  const t = traits(g);
  const R = stageEvidence(model.stages.reply, t, g.id);
  const Y = stageEvidence(model.stages.yes, t, g.id);
  if (n < MIN_LABELLED || (!R.evidence && !Y.evidence && model.pos <= 0)) {
    out.note = `Learning starts once ${MIN_LABELLED}+ guests have an outcome (accepted, rejected or no reply) and at least one said yes.`;
    return out;
  }

  // Nearest labelled guests (overall outcome), as before.
  const near = model.labelled
    .filter((l) => l.g.id !== g.id)
    .map((l) => ({ l, s: traitSimilarity(t, l.t) }))
    .filter((x) => x.s >= 0.3)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5);
  // Neighbours count only when they differ from what usually happens (with 11 yeses and 2 no's,
  // "similar guests said yes" is expected and shouldn't lift everyone).
  let knn = 0;
  const others = model.labelled.filter((l) => l.g.id !== g.id);
  const wy = others.reduce((a, l) => a + l.o.w * l.o.y, 0), wt = others.reduce((a, l) => a + l.o.w, 0);
  const usual = wt ? wy / wt : 0.5;
  const minority = Math.min(wy, wt - wy);
  if (near.length) {
    const den = near.reduce((a, x) => a + x.s * x.l.o.w, 0);
    const local = near.reduce((a, x) => a + x.s * x.l.o.w * x.l.o.y, 0) / den;
    knn = (local - usual) * 2 * Math.min(1, minority / MINORITY_FOR_FULL);
  }

  // Combine: chance of yes = chance of reply × chance of yes once they reply. Each question shifts
  // the AI's estimate in log-odds; neighbours add a smaller nudge. Capped at ±MAX_ADJUST points.
  const lr = squash(R.evidence, R.n), ly = squash(Y.evidence, Y.n);
  const p = Math.min(0.97, Math.max(0.03, base / 100));
  const shifted = 1 / (1 + Math.exp(-(logit(p) + lr + ly + 0.6 * knn * Math.min(1, n / FULL_CONFIDENCE_AT))));
  const adjust = Math.max(-MAX_ADJUST, Math.min(MAX_ADJUST, Math.round((shifted - p) * 100)));
  out.adjust = adjust;
  out.active = true;
  out.confidence = Math.min(1, n / FULL_CONFIDENCE_AT);

  // Plain-language estimates for the two questions (only when there's data for them).
  const est = (S, l) => (S.p0 == null || !(S.pos > 0 && S.neg > 0) ? null : Math.round(100 / (1 + Math.exp(-(logit(S.p0) + l)))));
  out.replyChance = est(R, lr);
  out.yesIfReply = est(Y, ly);
  out.basis = { replied: R.pos ?? 0, silent: R.neg ?? 0, saidYes: Y.pos ?? 0, saidNo: Y.neg ?? 0 };

  const reasons = [
    ...R.contrib.map((x) => ({ ...x, q: "reply" })),
    ...Y.contrib.map((x) => ({ ...x, q: "yes" })),
  ].filter((x) => x.k !== "company" && Math.abs(x.c) > 0.08).sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, 4);
  for (const x of reasons) {
    const total = x.pN + x.nN;
    const what = x.q === "reply" ? (x.c > 0 ? "more likely to reply" : "less likely to reply") : x.c > 0 ? "more likely to say yes" : "less likely to say yes";
    const stat = total ? ` · ${x.pN} of ${total} similar past guest${total > 1 ? "s" : ""} ${x.q === "reply" ? "replied" : "said yes"}` : "";
    out.reasons.push({ dir: x.c > 0 ? "up" : "down", q: x.q, text: `${TRAIT_LABEL[x.k]}: ${pretty(x.k, x.v, g)} → ${what}${stat}` });
  }
  out.neighbours = near.slice(0, 3).map((x) => ({ id: x.l.g.id, name: x.l.g.name, company: x.l.g.company, outcome: x.l.o.label, similarity: Math.round(x.s * 100), yes: !!x.l.o.y }));
  return out;
}

/** How well the scores predicted real outcomes, testing each past guest with their own result hidden.
 *  ranking = chance a random "yes" guest scored higher than a random "no" guest (50% = guessing). */
export function evaluate(guests, now = Date.now()) {
  // Use the AI's own score as the starting point, even if learning was already applied.
  guests = guests.map((g) => (typeof g.aiScore === "number" ? { ...g, score: g.aiScore } : g));
  const model = buildModel(guests, now);
  const rows = model.labelled.filter((l) => l.o.w >= 0.3 && typeof l.g.score === "number");
  const pairs = (key) => {
    const yes = rows.filter((r) => r.o.y), no = rows.filter((r) => !r.o.y);
    if (!yes.length || !no.length) return null;
    let win = 0;
    for (const a of yes) for (const b of no) win += key(a) > key(b) ? 1 : key(a) === key(b) ? 0.5 : 0;
    return Math.round((win / (yes.length * no.length)) * 100);
  };
  const learned = (r) => { const l = scoreGuest(r.g, model); return l.base + l.adjust; };
  return {
    yes: rows.filter((r) => r.o.y).length,
    no: rows.filter((r) => !r.o.y).length,
    aiOnly: pairs((r) => r.g.score),
    withLearning: pairs(learned),
    outcomes: model.outcomes,
  };
}

/** Guest with learned score applied (score = adjusted, aiScore = original). */
export function applyLearning(g, model) {
  const l = scoreGuest(g, model);
  if (l.base == null) return { ...g, aiScore: null, learning: l };
  const score = Math.max(0, Math.min(100, l.base + l.adjust));
  return { ...g, aiScore: l.base, score, likelihood: tierOf(score), learning: l };
}

/** What accepted guests have in common (for the Recommendations page and AI prompts). */
export function successProfile(model) {
  const p0 = (model.pos + 1) / (model.pos + model.neg + 2);
  const rows = [];
  for (const [key, c] of model.counts) {
    const [k, v] = key.split("|");
    if (c.posN < 1 || k === "company") continue;
    const pv = (c.pos + 2 * p0) / (c.pos + c.neg + 2);
    const example = model.labelled.find((l) => l.t.some(([a, b]) => a === k && b === v))?.g;
    rows.push({ trait: TRAIT_LABEL[k], key: k, value: pretty(k, v, example), yes: c.posN, total: c.posN + c.negN, lift: pv - p0 });
  }
  const strongest = rows.filter((r) => r.lift > 0).sort((a, b) => b.lift * Math.sqrt(b.yes) - a.lift * Math.sqrt(a.yes)).slice(0, 8);
  const warnings = [];
  for (const [key, c] of model.counts) {
    const [k, v] = key.split("|");
    if (c.negN >= 1 && c.posN === 0 && k !== "company") {
      const example = model.labelled.find((l) => l.t.some(([a, b]) => a === k && b === v))?.g;
      warnings.push({ trait: TRAIT_LABEL[k], value: pretty(k, v, example), no: c.negN });
    }
  }
  return { traits: strongest, warnings: warnings.sort((a, b) => b.no - a.no).slice(0, 5), outcomes: model.outcomes };
}

const OPEN = ["Discovered", "Shortlisted", "Contact later"];

/** Uncontacted guests ranked by learned score, with reasons. Hides ones marked not relevant. */
export function nextBest(guests, limit = 5) {
  return guests
    .filter((g) => OPEN.includes(g.stage) && g.recFeedback !== "irrelevant")
    .map((g) => {
      const why = [];
      let rank = g.score ?? 40;
      if (g.stage === "Shortlisted") { rank += 6; why.push("you shortlisted them"); }
      if (g.recFeedback === "relevant") { rank += 4; why.push("you marked them relevant"); }
      if (g.learning?.adjust > 0) why.push(`+${g.learning.adjust} from past outcomes`);
      const yesNeighbour = g.learning?.neighbours?.find((n) => n.yes);
      if (yesNeighbour) why.push(`${yesNeighbour.similarity}% similar to ${yesNeighbour.name}, who said yes`);
      const strong = (g.result?.acceptance?.criteria || []).filter((c) => c.found && c.score >= 8).map((c) => c.label.toLowerCase());
      if (strong.length) why.unshift(`strong on ${strong.slice(0, 2).join(" and ")}`);
      return { guest: g, rank, why };
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit);
}

/** Open guests most similar to guests who said yes, preferring OTHER companies than the match. */
export function similarProfiles(guests, limit = 6) {
  const seeds = guests.filter((g) => outcomeOf(g)?.y === 1 && outcomeOf(g).w >= 0.6);
  const out = [];
  for (const g of guests.filter((x) => OPEN.includes(x.stage) && x.recFeedback !== "irrelevant")) {
    let best = null;
    for (const s of seeds) {
      const sim = similarityTo(g, s);
      if (sim < 0.3) continue;
      const otherCompany = companyKey(g) !== companyKey(s);
      const rank = sim + (otherCompany ? 0.05 : 0);
      if (!best || rank > best.rank) best = { seed: s, sim, rank, otherCompany };
    }
    if (best) out.push({ guest: g, ...best, reasons: sharedTraits(g, best.seed) });
  }
  return out.sort((a, b) => b.rank - a.rank).slice(0, limit);
}

export function sharedTraits(a, b) {
  const tb = new Set(traits(b).map(([k, v]) => `${k}|${v}`));
  const out = [];
  for (const [k, v] of traits(a)) {
    if (k === "company" || k === "signal" || k === "growth" || !tb.has(`${k}|${v}`)) continue;
    out.push(k === "expertise" ? v : pretty(k, v, a));
  }
  return [...new Set(out)].slice(0, 4);
}
