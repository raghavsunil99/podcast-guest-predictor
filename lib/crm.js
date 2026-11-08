import { analyzeCareer, fmtMonths } from "./career.js";

// Shared guest-CRM logic (used by both the server store and the UI). No Node-only imports here.

// Main path, in order. Side outcomes are tracked separately and never count as progress.
export const STAGES = ["Discovered", "Shortlisted", "Contacted", "Responded", "Accepted", "Recorded"];
export const SIDE_STAGES = ["Contact later", "Not responded", "Rejected"];
export const ALL_STAGES = ["Discovered", "Shortlisted", "Contact later", "Contacted", "Not responded", "Responded", "Accepted", "Rejected", "Recorded"];
export const CLOSED_STAGES = ["Recorded", "Rejected", "Not responded"];
export const STAGE_HINT = {
  Discovered: "Profile studied",
  Shortlisted: "Worth inviting",
  "Contact later": "Parked for now",
  Contacted: "Invite sent",
  "Not responded": "No reply after follow-ups",
  Responded: "They replied",
  Accepted: "Said yes to the podcast",
  Rejected: "Said no",
  Recorded: "Episode recorded",
};
export const stageClass = (s) => `stage-${String(s).replace(/\s+/g, "")}`;
// v1 history statuses and v2.0 stage names → current stages
export const LEGACY_STATUS = {
  Drafted: "Discovered", Sent: "Contacted", Replied: "Responded", Scheduled: "Accepted", Recorded: "Recorded", Declined: "Rejected",
};
const RENAMED = { Confirmed: "Accepted", Declined: "Rejected" };
export function migrateStages(g) {
  if (!RENAMED[g.stage] && !Object.keys(g.milestones || {}).some((k) => RENAMED[k])) return g;
  const milestones = {};
  for (const [k, v] of Object.entries(g.milestones || {})) milestones[RENAMED[k] || k] = v;
  return { ...g, stage: RENAMED[g.stage] || g.stage, milestones };
}

export const TIERS = {
  High: { label: "High potential", short: "High" },
  Medium: { label: "Medium potential", short: "Medium" },
  Low: { label: "Low potential", short: "Low" },
};
export function tierOf(g) {
  if (g?.likelihood && TIERS[g.likelihood]) return g.likelihood;
  const s = typeof g === "number" ? g : g?.score;
  if (typeof s !== "number") return "Low";
  return s >= 65 ? "High" : s >= 45 ? "Medium" : "Low";
}

const clean = (v) => {
  const s = v == null ? "" : String(v).trim();
  return s && !/^(unknown|n\/a|none|not (stated|found|listed))$/i.test(s) ? s : "";
};
export const normText = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
export const normName = (s) => normText(s).replace(/\b(dr|mr|mrs|ms|prof)\b/g, "").replace(/\s+/g, " ").trim();
export function normLinkedIn(u) {
  const m = String(u || "").match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).toLowerCase() : "";
}
export function normDomain(d) {
  return clean(d).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");
}
// A usable website looks like "adobe.com"; values such as "technology" are AI mistakes.
export const validDomain = (d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(normDomain(d));

// Companies are grouped by name (Adobe, Adobe Inc and Adobe India are one company), so
// different regional websites (americanairlines.in / .com) don't split a company in two.
export function companyKey(g) {
  const name = normText(g.company).replace(/\b(pvt|private|ltd|limited|inc|llc|corp|corporation|co|technologies|technology|india|solutions|global)\b/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (name) return name;
  return validDomain(g.companyDomain) ? normDomain(g.companyDomain).replace(/\.(com|in|co|io|org|net)(\.[a-z]{2})?$/, "") : "";
}

// Guest fields derived from the structured career history (recomputed whenever it changes).
export function careerFields(r) {
  const p = r?.profile || {};
  const c = analyzeCareer(p.experience);
  return {
    experience: c.totalMonths ? fmtMonths(c.totalMonths, c.approx) : clean(p.totalExperience),
    pastCompanies: c.pastCompanies,
    colleges: (p.education || []).map((e) => e.institution).filter(Boolean),
    careerTags: [...c.tags, ...(p.careerSwitch ? ["Career switch"] : [])],
  };
}

// Turn a /api/generate result into guest fields.
export function guestFromResult(r, { url = "" } = {}) {
  const p = r.profile || {}, bg = r.background || {}, acc = r.acceptance || {}, ss = r.socialSignals || {}, c = r.contact || {};
  return {
    name: clean(p.fullName) || "Unknown",
    firstName: clean(p.firstName),
    role: clean(p.currentRole),
    company: clean(p.currentCompany),
    companyDomain: normDomain(p.companyDomain),
    industry: clean(p.industry),
    domain: clean(p.domain),
    city: clean(p.currentCity),
    location: clean(p.location),
    ...careerFields(r),
    skills: Array.isArray(p.skills) ? p.skills.slice(0, 12) : [],
    linkedinUrl: clean(url) || clean(c.linkedin),
    photoUrl: /^https?:\/\//.test(clean(p.photoUrl)) ? clean(p.photoUrl) : "",
    language: clean(bg.nativeLanguage),
    region: clean(bg.nativeRegion),
    langConfidence: bg.confidence || "",
    score: typeof acc.score === "number" ? acc.score : null,
    likelihood: acc.likelihood || "",
    followers: clean(ss.followers),
    contact: { email: clean(c.email), phone: clean(c.phone), website: clean(c.website) },
    result: r,
  };
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const activity = (type, text, t = new Date().toISOString()) => ({ id: newId(), t, type, text });

// Move a guest to a stage. Milestones record the first time each stage was reached, so the
// funnel counts "ever contacted" even after a guest moves on. Moving backwards clears later ones.
export function applyStage(g, stage, now = new Date().toISOString()) {
  if (!ALL_STAGES.includes(stage) || g.stage === stage) return g;
  const m = { ...(g.milestones || {}) };
  const ensure = (list) => list.forEach((s) => (m[s] ||= now));
  const drop = (list) => list.forEach((s) => delete m[s]);
  if (stage === "Contact later") {
    drop(["Not responded", "Rejected"]);
    m["Contact later"] = now;
  } else if (stage === "Not responded") {
    ensure(["Discovered", "Contacted"]);
    drop(["Responded", "Accepted", "Recorded", "Rejected"]);
    m["Not responded"] = now;
  } else if (stage === "Rejected") {
    ensure(["Discovered", "Contacted", "Responded"]);
    drop(["Accepted", "Recorded", "Not responded"]);
    m.Rejected = now;
  } else {
    const i = STAGES.indexOf(stage);
    STAGES.forEach((s, j) => (j <= i ? (m[s] ||= now) : delete m[s]));
    drop(SIDE_STAGES);
  }
  const episode = { ...(g.episode || {}) };
  if (stage === "Recorded" && !episode.recordedAt) episode.recordedAt = now.slice(0, 10);
  return {
    ...g,
    stage,
    milestones: m,
    episode,
    stageChangedAt: now,
    activity: [activity("stage", `Moved from ${g.stage || "—"} to ${stage}`, now), ...(g.activity || [])],
  };
}
export const reached = (g, s) => !!g.milestones?.[s];

const DAY = 86400000;
export const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY) : null);

export function followUpsDue(guests, days = 5) {
  const out = [];
  for (const g of guests) {
    if (g.nextFollowUpAt && !CLOSED_STAGES.includes(g.stage) && new Date(g.nextFollowUpAt).getTime() <= Date.now()) {
      out.push({ guest: g, reason: "Reminder date reached", waiting: daysSince(g.nextFollowUpAt) });
      continue;
    }
    if (g.stage !== "Contacted") continue;
    const since = g.lastFollowUpAt || g.milestones?.Contacted;
    const d = daysSince(since);
    if (d != null && d >= days) out.push({ guest: g, reason: g.lastFollowUpAt ? `No reply ${d} days after follow-up` : `No reply for ${d} days`, waiting: d });
  }
  return out.sort((a, b) => b.waiting - a.waiting);
}

export function analytics(guests) {
  const count = (s) => guests.filter((g) => reached(g, s)).length;
  const funnel = STAGES.map((s) => ({ stage: s, n: count(s) }));
  const total = guests.length;
  const contacted = count("Contacted");
  const responded = count("Responded");
  const recorded = count("Recorded");
  const companies = groupCompanies(guests);
  const tiers = { High: 0, Medium: 0, Low: 0, Unscored: 0 };
  for (const g of guests) tiers[typeof g.score === "number" ? tierOf(g) : "Unscored"]++;
  return {
    total,
    contacted,
    responded,
    accepted: count("Accepted"),
    recorded,
    rejected: guests.filter((g) => g.stage === "Rejected").length,
    notResponded: guests.filter((g) => g.stage === "Not responded").length,
    contactLater: guests.filter((g) => g.stage === "Contact later").length,
    byStage: Object.fromEntries(ALL_STAGES.map((s) => [s, guests.filter((g) => g.stage === s).length])),
    inPipeline: guests.filter((g) => !CLOSED_STAGES.includes(g.stage)).length,
    conversion: total ? recorded / total : 0,
    responseRate: contacted ? responded / contacted : 0,
    funnel,
    companies,
    tiers,
  };
}

export function groupCompanies(guests) {
  const map = new Map();
  for (const g of guests) {
    const key = companyKey(g);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { key, name: g.company, domain: "", industry: g.industry, members: [] });
    const c = map.get(key);
    c.members.push(g);
    // Prefer a valid .com website for the logo; ignore invalid ones.
    if (validDomain(g.companyDomain) && (!c.domain || (!c.domain.endsWith(".com") && normDomain(g.companyDomain).endsWith(".com")))) c.domain = normDomain(g.companyDomain);
    c.industry ||= g.industry;
  }
  return [...map.values()]
    .map((c) => {
      const scored = c.members.filter((m) => typeof m.score === "number");
      return {
        ...c,
        guests: c.members.length,
        contacted: c.members.filter((m) => reached(m, "Contacted")).length,
        recorded: c.members.filter((m) => reached(m, "Recorded")).length,
        open: c.members.filter((m) => ["Discovered", "Shortlisted", "Contact later"].includes(m.stage)).length,
        avgScore: scored.length ? Math.round(scored.reduce((t, m) => t + m.score, 0) / scored.length) : null,
        // Guests who used to work here (from their career history)
        alumni: guests.filter((g) => !c.members.includes(g) && (g.pastCompanies || []).some((pc) => companyKey({ company: pc }) === companyKey({ company: c.name }))),
      };
    })
    .sort((a, b) => b.guests - a.guests || b.recorded - a.recorded || a.name.localeCompare(b.name));
}

export function findDuplicates(guests) {
  const groups = new Map();
  for (const g of guests) {
    const k = normLinkedIn(g.linkedinUrl) || normName(g.name);
    if (!k || k === "unknown") continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(g);
  }
  return [...groups.values()].filter((l) => l.length > 1);
}

// ---------- Export ----------
const CSV_COLS = [
  ["Name", (g) => g.name], ["Role", (g) => g.role], ["Company", (g) => g.company], ["Company website", (g) => g.companyDomain],
  ["Industry", (g) => g.industry], ["Domain", (g) => g.domain], ["City", (g) => g.city], ["Likely native language", (g) => g.language],
  ["Prediction score", (g) => g.score ?? ""], ["AI profile score", (g) => g.aiScore ?? g.score ?? ""], ["Learned adjustment", (g) => g.learning?.adjust ?? ""],
  ["Potential", (g) => tierOf(g)], ["Stage", (g) => g.stage],
  ["Email", (g) => g.contact?.email], ["Phone", (g) => g.contact?.phone], ["Website", (g) => g.contact?.website],
  ["LinkedIn", (g) => g.linkedinUrl], ["Followers", (g) => g.followers],
  ["Discovered on", (g) => g.milestones?.Discovered?.slice(0, 10) || g.createdAt?.slice(0, 10)],
  ["Contacted on", (g) => g.milestones?.Contacted?.slice(0, 10)], ["Accepted on", (g) => g.milestones?.Accepted?.slice(0, 10)], ["Recorded on", (g) => g.episode?.recordedAt],
  ["Episode title", (g) => g.episode?.title], ["Episode link", (g) => g.episode?.link],
  ["Total experience", (g) => g.experience], ["Previous companies", (g) => (g.pastCompanies || []).join(" | ")],
  ["Colleges", (g) => (g.colleges || []).join(" | ")], ["Career pattern", (g) => (g.careerTags || []).join(" | ")],
  ["Notes", (g) => (g.notes || []).map((n) => n.text).join(" | ")],
];
export function toCSV(guests) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [CSV_COLS.map((c) => c[0]).join(","), ...guests.map((g) => CSV_COLS.map((c) => esc(c[1](g))).join(","))].join("\r\n");
}

// ---------- Merging duplicate guests ----------
// Which record to keep: the one further along the pipeline, then the most recently updated.
export function pickPrimary(a, b) {
  const rank = (g) => ALL_STAGES.indexOf(g.stage);
  if (rank(a) !== rank(b)) return rank(a) > rank(b) ? [a, b] : [b, a];
  return String(a.updatedAt || "") >= String(b.updatedAt || "") ? [a, b] : [b, a];
}

// Combine `drop` into `keep` without losing anything: notes, history, contact details,
// episode details and the earliest date each stage was reached.
export function mergeGuestRecords(keep, drop, now = new Date().toISOString()) {
  const g = structuredClone(keep);
  const fill = (k) => { if (!g[k] && drop[k]) g[k] = drop[k]; };
  ["linkedinUrl", "photoUrl", "companyDomain", "industry", "city", "language", "role", "company", "recFeedback"].forEach(fill);
  g.contact = { ...(drop.contact || {}), ...Object.fromEntries(Object.entries(g.contact || {}).filter(([, v]) => v)) };
  g.contactSource = { ...(drop.contactSource || {}), ...(g.contactSource || {}) };
  g.episode = { ...(drop.episode || {}), ...Object.fromEntries(Object.entries(g.episode || {}).filter(([, v]) => v !== "" && v != null)) };
  const ms = { ...(g.milestones || {}) };
  for (const [st, at] of Object.entries(drop.milestones || {})) if (!ms[st] || at < ms[st]) ms[st] = at;
  g.milestones = ms;
  const seen = new Set();
  g.notes = [...(g.notes || []), ...(drop.notes || [])]
    .filter((n) => { const k = n.id || n.text; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((x, y) => String(y.t || y.at || "").localeCompare(String(x.t || x.at || "")));
  g.activity = [
    activity("update", `Merged a duplicate record (was ${drop.stage})`, now),
    ...[...(g.activity || []), ...(drop.activity || [])].sort((x, y) => String(y.t || y.at || "").localeCompare(String(x.t || x.at || ""))),
  ];
  if (drop.createdAt && (!g.createdAt || drop.createdAt < g.createdAt)) g.createdAt = drop.createdAt;
  g.updatedAt = now;
  return g;
}

const JOB_TITLE = /^(senior |sr\.? |junior |jr\.? |lead |principal |staff |associate )?(software|data|ml|machine learning|full[- ]?stack|backend|frontend|qa|test|devops|cloud|product|project|program)? ?(engineer|developer|analyst|scientist|manager|intern|architect|consultant|designer|lead)\b/i;

// Previous employers, newest first, without repeats or the current company.
export function previousCompanies(g, max = 4) {
  const cur = companyKey(g);
  const seen = new Set(cur ? [cur] : []);
  const out = [];
  for (const name of g.pastCompanies || []) {
    const k = companyKey({ company: name });
    // Career data sometimes puts a job title in the company field ("Software Engineer II").
    if (!k || seen.has(k) || JOB_TITLE.test(name)) continue;
    seen.add(k);
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}

// Turn the invite's personal hook ("Your transition from X to Y") into an episode topic
// ("Transition from X to Y") for archive cards.
export function episodeTopic(hook) {
  let t = String(hook || "").trim().replace(/[.\s]+$/, "");
  if (!t) return "";
  t = t.replace(/^(your|his|her|their)\s+/i, "").replace(/\byour\b/gi, "their").replace(/\byou\b/gi, "they");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
