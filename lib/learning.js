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

/** Outcome label: y=1 said yes, y=0 said no/no reply; w = how much to trust it. */
export function outcomeOf(g) {
  if (reached(g, "Accepted") || g.stage === "Recorded") return { y: 1, w: 1, label: g.stage === "Recorded" ? "Recorded" : "Accepted" };
  if (g.stage === "Rejected") return { y: 0, w: 1, label: "Rejected" };
  if (g.stage === "Not responded") return { y: 0, w: 0.6, label: "Not responded" };
  if (g.recFeedback === "relevant") return { y: 1, w: 0.3, label: "Marked relevant" };
  if (g.recFeedback === "irrelevant") return { y: 0, w: 0.3, label: "Marked not relevant" };
  return null;
}

export function buildModel(guests) {
  const labelled = [];
  const counts = new Map(); // "trait|value" → { pos, neg }
  let pos = 0, neg = 0;
  for (const g of guests) {
    const o = outcomeOf(g);
    if (!o) continue;
    const t = traits(g);
    labelled.push({ g, o, t });
    o.y ? (pos += o.w) : (neg += o.w);
    for (const [k, v] of t) {
      const key = `${k}|${v}`;
      const c = counts.get(key) || { pos: 0, neg: 0, posN: 0, negN: 0 };
      if (o.y) { c.pos += o.w; if (o.w >= 0.6) c.posN++; } else { c.neg += o.w; if (o.w >= 0.6) c.negN++; }
      counts.set(key, c);
    }
  }
  const strong = labelled.filter((l) => l.o.w >= 0.6);
  return {
    labelled,
    counts,
    pos,
    neg,
    outcomes: {
      yes: strong.filter((l) => l.o.y).length,
      no: strong.filter((l) => !l.o.y).length,
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

/** Learned adjustment for one guest, with reasons. Leave-one-out: a guest's own outcome never
 *  counts towards its own score. */
export function scoreGuest(g, model) {
  const base = typeof g.score === "number" ? g.score : null;
  const self = model.labelled.find((l) => l.g.id === g.id);
  const own = self ? { y: self.o.y, w: self.o.w } : null;
  const pos = model.pos - (own?.y ? own.w : 0);
  const neg = model.neg - (own && !own.y ? own.w : 0);
  const n = model.labelled.length - (own ? 1 : 0);
  const out = { base, adjust: 0, reasons: [], neighbours: [], learnedFrom: n, active: false };
  if (base == null) return out;
  if (n < MIN_LABELLED || pos <= 0) {
    out.note = `Learning starts once ${MIN_LABELLED}+ guests have an outcome (accepted, rejected or no reply) and at least one said yes.`;
    return out;
  }
  const p0 = (pos + 1) / (pos + neg + 2);
  const t = traits(g);

  // 1. Trait evidence
  const contrib = [];
  const perType = {};
  for (const [k, v] of t) {
    const c = model.counts.get(`${k}|${v}`);
    if (!c) continue;
    let cp = c.pos, cn = c.neg, pN = c.posN, nN = c.negN;
    if (own && self.t.some(([k2, v2]) => k2 === k && v2 === v)) {
      if (own.y) { cp -= own.w; if (own.w >= 0.6) pN--; } else { cn -= own.w; if (own.w >= 0.6) nN--; }
    }
    if (cp + cn <= 0) continue;
    const a = 2;
    const pv = (cp + a * p0) / (cp + cn + a);
    const lift = logit(Math.min(0.99, Math.max(0.01, pv))) - logit(p0);
    (perType[k] ||= []).push({ k, v, lift, pN: Math.max(0, pN), nN: Math.max(0, nN) });
  }
  let evidence = 0;
  for (const [k, list] of Object.entries(perType)) {
    const w = TRAIT_WEIGHT[k] / (MULTI.has(k) ? Math.max(1, list.length) : 1);
    for (const x of list) {
      const c = w * x.lift;
      evidence += c;
      contrib.push({ ...x, c });
    }
  }

  // 2. Nearest labelled guests
  const near = model.labelled
    .filter((l) => l.g.id !== g.id)
    .map((l) => ({ l, s: traitSimilarity(t, l.t) }))
    .filter((x) => x.s >= 0.3)
    .sort((a, b) => b.s - a.s)
    .slice(0, 5);
  let knn = 0;
  if (near.length) {
    const den = near.reduce((a, x) => a + x.s * x.l.o.w, 0);
    knn = near.reduce((a, x) => a + x.s * x.l.o.w * (x.l.o.y ? 1 : -1), 0) / den;
  }

  const confidence = Math.min(1, n / FULL_CONFIDENCE_AT);
  const raw = MAX_ADJUST * (0.6 * Math.tanh(evidence / 1.2) + 0.4 * knn) * (0.4 + 0.6 * confidence);
  const adjust = Math.max(-MAX_ADJUST, Math.min(MAX_ADJUST, Math.round(raw)));
  out.adjust = adjust;
  out.active = true;
  out.confidence = confidence;

  const top = contrib.filter((x) => Math.abs(x.c) > 0.08).sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, 4);
  for (const x of top) {
    const total = x.pN + x.nN;
    out.reasons.push({
      dir: x.c > 0 ? "up" : "down",
      text: `${TRAIT_LABEL[x.k]}: ${pretty(x.k, x.v, g)}${total ? ` · ${x.pN} of ${total} similar past guest${total > 1 ? "s" : ""} said yes` : ""}`,
    });
  }
  out.neighbours = near.slice(0, 3).map((x) => ({ id: x.l.g.id, name: x.l.g.name, company: x.l.g.company, outcome: x.l.o.label, similarity: Math.round(x.s * 100), yes: !!x.l.o.y }));
  return out;
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
