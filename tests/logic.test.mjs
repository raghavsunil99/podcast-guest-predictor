// Unit tests for the pure logic: scoring, CRM stages, career calculations, learning.
// Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { scoreAcceptance, applyManualSignals, parseCount } from "../lib/scoring.js";
import { applyStage, analytics, findDuplicates, followUpsDue, guestFromResult, migrateStages, toCSV, tierOf } from "../lib/crm.js";
import { analyzeCareer, fmtMonths, isService, isBigTech } from "../lib/career.js";
import { buildModel, applyLearning, nextBest, similarProfiles, outcomeOf } from "../lib/learning.js";
import { parseJSON, strictSchema } from "../lib/ai/schema.js";
import { trimLinkedInText } from "../lib/pdfText.js";
import { normalizeResult, collegeType, cleanRole } from "../lib/normalize.js";

// ---------- helpers ----------
let n = 0;
const crit = (o = {}) =>
  ["audience", "posting", "speaking", "mentoring", "story", "accessibility"].map((id) => ({
    id, score: o[id] ?? 5, evidence: o[id] != null ? "shown" : "Not shown", found: o[id] != null,
  }));
function guest({ role = "Engineer", company = "Acme", industry = "Software", exp = "5 years", skills = ["Python"], score = 60, stage = "Discovered", sig = {}, experience } = {}) {
  let g = {
    id: `g${++n}`, name: `Guest ${n}`, role, company, industry, experience: exp, skills, domain: skills[0], city: "Bengaluru",
    score, stage: "Discovered", milestones: { Discovered: "2026-01-01T00:00:00Z" },
    result: { acceptance: { criteria: crit(sig) }, profile: { experience } },
  };
  return stage === "Discovered" ? g : applyStage(g, stage);
}

// ---------- scoring ----------
test("score is the weighted sum of criteria and sets the tier", () => {
  const d = { acceptance: { criteria: crit({ audience: 10, posting: 10, speaking: 10, mentoring: 10, story: 10, accessibility: 10 }) } };
  scoreAcceptance(d);
  assert.equal(d.acceptance.score, 100);
  assert.equal(d.acceptance.likelihood, "High");
  assert.equal(d.acceptance.dataCoverage, 6);
});

test("missing criteria count as 5/10 (neutral) and lower coverage", () => {
  const d = { acceptance: { criteria: [] } };
  scoreAcceptance(d);
  assert.equal(d.acceptance.score, 50);
  assert.equal(d.acceptance.likelihood, "Medium");
  assert.equal(d.acceptance.dataCoverage, 0);
});

test("tier boundaries: 65+ high, 45–64 medium, under 45 low", () => {
  assert.equal(tierOf(65), "High");
  assert.equal(tierOf(64), "Medium");
  assert.equal(tierOf(45), "Medium");
  assert.equal(tierOf(44), "Low");
});

test("hand-entered LinkedIn signals rescore the guest", () => {
  const r = { socialSignals: { followers: "Unknown" }, acceptance: { criteria: crit({ story: 8, accessibility: 8 }) } };
  scoreAcceptance(r);
  const before = r.acceptance.score;
  const out = applyManualSignals(r, { followers: "6,300", postingActivity: "Frequent", publicSpeaking: "Some" });
  assert.ok(out.acceptance.score > before);
  assert.equal(out.acceptance.criteria.find((c) => c.id === "audience").score, 8);
  assert.equal(out.acceptance.dataCoverage, 5);
  assert.equal(r.acceptance.score, before, "original result is not mutated");
  assert.equal(parseCount("12.4k followers"), 12400);
});

// ---------- stages ----------
test("moving forward records every earlier milestone", () => {
  const g = applyStage(guest(), "Accepted");
  for (const s of ["Discovered", "Shortlisted", "Contacted", "Responded", "Accepted"]) assert.ok(g.milestones[s], s);
  assert.ok(!g.milestones.Recorded);
});

test("moving backwards clears later milestones", () => {
  const g = applyStage(applyStage(guest(), "Responded"), "Shortlisted");
  assert.ok(!g.milestones.Contacted && !g.milestones.Responded);
});

test("Rejected implies contacted and responded; Not responded implies contacted only", () => {
  const r = applyStage(guest(), "Rejected");
  assert.ok(r.milestones.Contacted && r.milestones.Responded && !r.milestones.Accepted);
  const nr = applyStage(guest(), "Not responded");
  assert.ok(nr.milestones.Contacted && !nr.milestones.Responded);
});

test("v2.0 stage names migrate to the new ones", () => {
  const g = migrateStages({ stage: "Confirmed", milestones: { Confirmed: "x", Declined: "y" } });
  assert.equal(g.stage, "Accepted");
  assert.ok(g.milestones.Accepted && g.milestones.Rejected);
});

test("analytics counts the funnel and conversion", () => {
  const list = [guest(), applyStage(guest(), "Contacted"), applyStage(guest(), "Recorded"), applyStage(guest(), "Rejected")];
  const a = analytics(list);
  assert.equal(a.total, 4);
  assert.equal(a.contacted, 3);
  assert.equal(a.recorded, 1);
  assert.equal(a.conversion, 0.25);
  assert.equal(a.inPipeline, 3, "a recorded episode is still in production until published");
});

test("follow-up is due after the configured days without reply", () => {
  const old = new Date(Date.now() - 7 * 86400000).toISOString();
  const g = applyStage(guest(), "Contacted", old);
  assert.equal(followUpsDue([g], 5).length, 1);
  assert.equal(followUpsDue([g], 10).length, 0);
});

test("duplicates are found by LinkedIn URL or same name", () => {
  const a = { id: "a", name: "Asha Rao", linkedinUrl: "https://www.linkedin.com/in/asha-rao/" };
  const b = { id: "b", name: "Asha R", linkedinUrl: "linkedin.com/in/Asha-Rao" };
  const c = { id: "c", name: "Someone Else" };
  assert.equal(findDuplicates([a, b, c]).length, 1);
});

test("CSV escapes commas, quotes and new lines", () => {
  const csv = toCSV([{ name: 'Rao, "AR"', notes: [{ text: "line1\nline2" }], stage: "Discovered" }]);
  assert.ok(csv.includes('"Rao, ""AR"""'));
  assert.ok(csv.includes('"line1\nline2"'));
});

test("guestFromResult ignores 'Unknown' values and keeps contacts", () => {
  const g = guestFromResult({ profile: { fullName: "A B", currentCity: "Unknown", companyDomain: "https://www.Acme.com/about" }, contact: { email: "a@b.co", phone: "Unknown" } });
  assert.equal(g.city, "");
  assert.equal(g.companyDomain, "acme.com");
  assert.equal(g.contact.email, "a@b.co");
  assert.equal(g.contact.phone, "");
});

// ---------- career ----------
const SAMPLE = [
  { company: "Digital School", employmentType: "Full-time", roles: [{ title: "Engineer", start: "2017", end: "2017" }] },
  { company: "Infosys Limited", employmentType: "Full-time", roles: [{ title: "Systems Engineer", start: "2018-01", end: "2021-05" }] },
  { company: "Microsoft", employmentType: "Full-time", roles: [
    { title: "Associate", start: "2021-06", end: "2022-12" },
    { title: "Software Engineer 2", start: "2024-01", end: "Present" },
    { title: "Software Engineer", start: "2023-01", end: "2023-12" },
  ] },
  { company: "Startup", employmentType: "Internship", roles: [{ title: "Intern", start: "2016-05", end: "2016-07" }] },
];

test("career: current job first, roles newest first (like LinkedIn)", () => {
  const c = analyzeCareer(SAMPLE);
  assert.equal(c.jobs[0].company, "Microsoft");
  assert.deepEqual(c.jobs[0].roles.map((r) => r.title), ["Software Engineer 2", "Software Engineer", "Associate"]);
});

test("career: promotions, moves and past companies", () => {
  const c = analyzeCareer(SAMPLE);
  assert.equal(c.promotions, 2);
  assert.ok(c.tags.includes("Service → Product"));
  assert.ok(c.tags.includes("Into Big Tech"));
  assert.deepEqual(c.pastCompanies, ["Infosys Limited", "Digital School"]);
  assert.equal(c.companies, 3, "internship not counted as a company");
});

test("career: overlapping periods aren't double counted; internships excluded", () => {
  const c = analyzeCareer([
    { company: "A", employmentType: "Full-time", roles: [{ title: "x", start: "2020-01", end: "2020-12" }] },
    { company: "B", employmentType: "Full-time", roles: [{ title: "y", start: "2020-07", end: "2021-06" }] },
    { company: "C", employmentType: "Internship", roles: [{ title: "z", start: "2019-01", end: "2019-06" }] },
  ]);
  assert.equal(c.totalMonths, 18);
  assert.equal(fmtMonths(18), "1 yr 6 mo");
});

test("career: year-only dates are approximate and not overstated", () => {
  const c = analyzeCareer([{ company: "A", employmentType: "Full-time", roles: [{ title: "x", start: "2017", end: "2017" }] }]);
  assert.equal(c.jobs[0].months, 6);
  assert.ok(c.approx);
});

test("company groups", () => {
  assert.ok(isService("Tata Consultancy Services"));
  assert.ok(isService("Infosys Limited"));
  assert.ok(isBigTech("Microsoft India"));
  assert.ok(!isBigTech("Razorpay"));
});

// ---------- learning ----------
function scenario() {
  const yes1 = guest({ role: "Engineering Manager", company: "Razorpay", industry: "Fintech", exp: "9 years", skills: ["Payments"], score: 80, stage: "Recorded", sig: { mentoring: 9 } });
  const yes2 = guest({ role: "Engineering Manager", company: "PhonePe", industry: "Fintech", exp: "10 years", skills: ["Payments"], score: 70, stage: "Accepted", sig: { mentoring: 8 } });
  const no1 = guest({ role: "VP Engineering", company: "Razorpay", industry: "Fintech", exp: "18 years", skills: ["Leadership"], score: 72, stage: "Rejected", sig: { mentoring: 3 } });
  const no2 = guest({ role: "Director of Product", company: "Flipkart", industry: "E-commerce", exp: "16 years", skills: ["Strategy"], score: 68, stage: "Not responded" });
  const similar = guest({ role: "Engineering Manager", company: "CRED", industry: "Fintech", exp: "9 years", skills: ["Payments"], score: 60, sig: { mentoring: 9 } });
  const vp = guest({ role: "VP Engineering", company: "Zomato", industry: "Food tech", exp: "17 years", skills: ["Leadership"], score: 60, sig: { mentoring: 3 } });
  const intern = guest({ role: "QA Intern", company: "Razorpay", industry: "Fintech", exp: "1 years", skills: ["Testing"], score: 60 });
  return { all: [yes1, yes2, no1, no2, similar, vp, intern], yes1, similar, vp, intern };
}

test("learning: profiles like past yeses go up, like past no's go down", () => {
  const s = scenario();
  const m = buildModel(s.all);
  const up = applyLearning(s.similar, m);
  const down = applyLearning(s.vp, m);
  assert.ok(up.learning.adjust > 0, `expected positive, got ${up.learning.adjust}`);
  assert.ok(down.learning.adjust < 0, `expected negative, got ${down.learning.adjust}`);
  assert.ok(up.learning.reasons.length > 0, "explains the adjustment");
});

test("learning: no blanket company boost (company alone barely matters)", () => {
  const s = scenario();
  const m = buildModel(s.all);
  const atYesCompany = applyLearning(s.intern, m).learning.adjust;
  const elsewhere = applyLearning({ ...s.intern, id: "other", company: "Unknown Startup Pvt Ltd" }, m).learning.adjust;
  assert.ok(Math.abs(atYesCompany - elsewhere) <= 2, `company effect ${atYesCompany - elsewhere}`);
  assert.ok(!applyLearning(s.intern, m).learning.reasons.some((r) => r.text.startsWith("Company:")));
});

test("learning: adjustments are capped and never use language/region", () => {
  const s = scenario();
  const m = buildModel(s.all);
  for (const g of s.all) {
    const r = applyLearning({ ...g, language: "Telugu", region: "Andhra Pradesh" }, m);
    assert.ok(Math.abs(r.learning.adjust) <= 15);
    assert.ok(!r.learning.reasons.some((x) => /telugu|andhra/i.test(x.text)));
  }
});

test("learning: a guest's own outcome doesn't count toward its own score", () => {
  const s = scenario();
  const r = applyLearning(s.yes1, buildModel(s.all));
  assert.equal(r.learning.learnedFrom, 3);
});

test("learning: inactive with too few outcomes", () => {
  const g = guest();
  const r = applyLearning(g, buildModel([g, guest({ stage: "Recorded" })]));
  assert.equal(r.learning.active, false);
  assert.equal(r.score, g.score);
});

test("recommendations: hide guests marked not relevant", () => {
  const s = scenario();
  const m = buildModel(s.all);
  const list = s.all.map((g) => applyLearning(g, m));
  list.find((g) => g.id === s.similar.id).recFeedback = "irrelevant";
  assert.ok(!nextBest(list).some((b) => b.guest.id === s.similar.id));
  assert.ok(!similarProfiles(list).some((x) => x.guest.id === s.similar.id));
  assert.equal(outcomeOf({ recFeedback: "irrelevant", milestones: {} }).w, 0.3);
});

// ---------- AI helpers ----------
test("strictSchema adds additionalProperties:false everywhere", () => {
  const s = strictSchema({ type: "object", properties: { a: { type: "array", items: { type: "object", properties: { b: { type: "string" } } } } } });
  assert.equal(s.additionalProperties, false);
  assert.equal(s.properties.a.items.additionalProperties, false);
  assert.deepEqual(s.properties.a.items.required, ["b"]);
});

test("parseJSON handles fenced and surrounded JSON", () => {
  assert.deepEqual(parseJSON('```json\n{"ok":true}\n```'), { ok: true });
  assert.deepEqual(parseJSON('Here you go: {"ok": 1} thanks'), { ok: 1 });
  assert.throws(() => parseJSON("no json here"));
});

test("LinkedIn PDF text: sidebar about other people is removed", () => {
  const main = "Asha Rao\nEngineer at Acme\n" + "Experience details. ".repeat(40);
  const out = trimLinkedInText(main + "More profiles for you\nSomeone Else\nPeople you may know\nX");
  assert.equal(out, main.trim());
  assert.equal(trimLinkedInText("short text"), "short text");
});

test("normalize: college type from the name", () => {
  assert.equal(collegeType("Indian Institute of Technology, Patna", "BITS"), "IIT");
  assert.equal(collegeType("International Institute of Information Technology Hyderabad", "BITS"), "IIIT");
  assert.equal(collegeType("NIT Warangal", "Other"), "NIT");
  assert.equal(collegeType("JNTU Kakinada", "State university / govt college"), "State university / govt college");
  assert.equal(collegeType("Some College", "BITS"), "Other", "wrong elite label removed");
});

test("normalize: role without repeated company", () => {
  assert.equal(cleanRole("Software Engineer 2 @ Microsoft @ Microsoft", "Microsoft"), "Software Engineer 2");
  assert.equal(cleanRole("Engineer at Acme", "Acme"), "Engineer");
  assert.equal(cleanRole("Head of Product", "Acme"), "Head of Product");
});

test("normalize: missing honorific added to every message for Telugu/Hindi speakers", () => {
  const d = normalizeResult({
    profile: { firstName: "Adithya" },
    background: { nativeLanguage: "Telugu", confidence: "High" },
    honorific: "",
    fullMessage: "Hi Adithya,\n\nHope you're well",
    connectionNote: "Hi Adithya, I'm Raghavendra",
    whatsappMessage: "Namaskaram Adithya, quick one",
    followUpMessage: "Hi Adithya garu, following up",
  }, "auto");
  assert.equal(d.honorific, "garu");
  assert.ok(d.fullMessage.startsWith("Hi Adithya garu,"));
  assert.ok(d.connectionNote.startsWith("Hi Adithya garu,"));
  assert.ok(d.whatsappMessage.startsWith("Namaskaram Adithya garu,"));
  assert.ok(d.followUpMessage.startsWith("Hi Adithya garu, following"), "not doubled");
});

test("normalize: honorific respects override and low confidence", () => {
  const base = () => ({ profile: { firstName: "Ravi" }, background: { nativeLanguage: "Telugu", confidence: "Low" }, honorific: "", fullMessage: "Hi Ravi," });
  assert.equal(normalizeResult(base(), "auto").honorific, "");
  const none = base(); none.background.confidence = "High";
  assert.equal(normalizeResult(none, "none").fullMessage, "Hi Ravi,");
});

// ---------- Per-model usage left today ----------
import { modelBreakdown, msUntilPacificMidnight } from "../lib/usage.js";

test("per-model usage counts used and left against each model's limit", () => {
  const p = { model: "flash", fallbackModels: ["lite"], modelLimits: { flash: 20, lite: 100 } };
  const e = (model, ok, errorType, t) => ({ model, ok, errorType, t: t || "2026-11-08T01:00:00Z", total: ok ? 1000 : 0 });
  const rows = modelBreakdown(p, [e("flash", true), e("flash", true), e("flash", false, "rate"), e("lite", true)]);
  assert.deepEqual(rows.map((r) => [r.model, r.used, r.left, r.exhausted]), [["flash", 3, 17, false], ["lite", 1, 99, false]]);
});

test("a daily-quota error marks the model used up even without a limit", () => {
  const p = { model: "flash", fallbackModels: [] };
  const rows = modelBreakdown(p, [
    { model: "flash", ok: true, t: "2026-11-08T01:00:00Z", total: 5 },
    { model: "flash", ok: false, errorType: "quota", t: "2026-11-08T02:00:00Z", total: 0 },
  ]);
  assert.equal(rows[0].exhausted, true);
  assert.equal(rows[0].left, 0);
  assert.equal(rows[0].used, 1, "the rejected request doesn't count as used");
});

test("reset countdown is within one day", () => {
  const ms = msUntilPacificMidnight();
  assert.ok(ms > 0 && ms <= 86400000);
});

// ---------- Company grouping ----------
import { groupCompanies } from "../lib/crm.js";

test("one company even with different or invalid websites", () => {
  const g = (id, company, companyDomain) => ({ id, name: id, company, companyDomain, stage: "Discovered" });
  const out = groupCompanies([
    g("a", "Adobe", "adobe.com"), g("b", "Adobe", "technology"), g("c", "Adobe Inc", ""),
    g("d", "American Airlines", "americanairlines.in"), g("e", "American Airlines", "americanairlines.com"),
  ]);
  assert.deepEqual(out.map((c) => [c.name, c.guests, c.domain]), [["Adobe", 3, "adobe.com"], ["American Airlines", 2, "americanairlines.com"]]);
});

// ---------- Merging duplicate guests ----------
import { mergeGuestRecords, pickPrimary } from "../lib/crm.js";

test("merge keeps the further stage and loses no notes, history or contact info", () => {
  const a = { id: "a", name: "Ravi", stage: "Discovered", updatedAt: "2026-11-08", createdAt: "2026-11-01", milestones: { Discovered: "2026-11-01" },
    notes: [{ id: "n1", text: "met at meetup", at: "2026-11-02" }], activity: [{ at: "2026-11-01", text: "created" }], contact: { email: "r@x.com" }, episode: {} };
  const b = { id: "b", name: "Ravi", stage: "Recorded", updatedAt: "2026-11-05", createdAt: "2026-11-03", milestones: { Discovered: "2026-11-03", Recorded: "2026-11-05" },
    notes: [{ id: "n2", text: "great call", at: "2026-11-05" }], activity: [{ at: "2026-11-05", text: "recorded" }], contact: { phone: "99" }, episode: { recordedAt: "2026-11-05" }, photoUrl: "/p" };
  const [keep, drop] = pickPrimary(a, b);
  assert.equal(keep.id, "b", "Recorded beats Discovered");
  const m = mergeGuestRecords(keep, drop, "2026-11-09");
  assert.equal(m.stage, "Recorded");
  assert.deepEqual(m.notes.map((n) => n.id), ["n2", "n1"]);
  assert.deepEqual(m.contact, { email: "r@x.com", phone: "99" });
  assert.equal(m.milestones.Discovered, "2026-11-01", "earliest date kept");
  assert.equal(m.createdAt, "2026-11-01");
  assert.equal(m.activity.length, 3);
  assert.equal(m.episode.recordedAt, "2026-11-05");
});

// ---------- Target companies ----------
import { cleanSuggestions, fitLabel, trackTargets } from "../lib/targets.js";

test("target suggestions skip companies you already have guests from and duplicates", () => {
  const guests = [{ id: "1", company: "Adobe", stage: "Discovered" }];
  const out = cleanSuggestions([
    { name: "Adobe Inc", domain: "adobe.com", fitScore: 90 },
    { name: "Zerodha", domain: "https://www.zerodha.com/", fitScore: 72.4, category: "Fintech" },
    { name: "Swiggy", domain: "swiggy.com", fitScore: 85, category: "Weird" },
    { name: "Zerodha", domain: "zerodha.com", fitScore: 60 },
  ], guests, [{ key: "swiggy" }]);
  assert.deepEqual(out.map((c) => [c.name, c.fitScore, c.domain, c.category]), [["Zerodha", 72, "zerodha.com", "Fintech"]]);
  assert.equal(fitLabel(85), "Best fit");
  assert.equal(fitLabel(70), "Good fit");
});

test("pinned targets move forward when guests from them appear", () => {
  const guests = [
    { id: "1", company: "Zerodha", stage: "Recorded", milestones: { Recorded: "x" } },
    { id: "2", company: "Swiggy", stage: "Discovered" },
  ];
  const out = trackTargets([
    { key: "zerodha", status: "Target" }, { key: "swiggy", status: "Searching" }, { key: "cred", status: "Searching" },
  ], guests);
  assert.deepEqual(out.map((t) => [t.status, t.progress.found]), [["Recorded", 1], ["Found guests", 1], ["Searching", 0]]);
});

test("previous companies: newest first, no repeats, no current company, no job titles", async () => {
  const { previousCompanies } = await import("../lib/crm.js");
  const g = { company: "Coactive AI", pastCompanies: ["Nuro", "Google", "Google LLC", "Software Engineer II", "Coactive AI", "MIT Media Lab"] };
  assert.deepEqual(previousCompanies(g), ["Nuro", "Google", "MIT Media Lab"]);
});

test("invite hook becomes an episode topic", async () => {
  const { episodeTopic } = await import("../lib/crm.js");
  assert.equal(episodeTopic("your transition from electrical engineering into software testing and your recent selection."), "Transition from electrical engineering into software testing and their recent selection");
  assert.equal(episodeTopic("His evolution from NLP to Agentic AI"), "Evolution from NLP to Agentic AI");
  assert.equal(episodeTopic("Founding the Thanjavur Marathi Language Platform"), "Founding the Thanjavur Marathi Language Platform");
});

// ---------- learning: reply vs yes, silence, accuracy ----------
import { evaluate, outcomeOf as outcome2, SILENCE_DAYS } from "../lib/learning.js";

test("outcomes split into 'did they reply' and 'did they say yes'", () => {
  const now = Date.parse("2026-11-20T00:00:00Z");
  const g = (stage, contacted) => ({ id: stage, name: stage, stage, milestones: { Contacted: contacted || "2026-11-01T00:00:00Z" } });
  assert.deepEqual(pick(outcome2(g("Rejected"), now)), { reply: 1, yes: 0 });
  assert.deepEqual(pick(outcome2(g("Not responded"), now)), { reply: 0, yes: null });
  assert.deepEqual(pick(outcome2(g("Responded"), now)), { reply: 1, yes: null });
  assert.equal(outcome2(g("Contacted", "2026-11-18T00:00:00Z"), now), null, "2 days of silence is too early to judge");
  const quiet = outcome2(g("Contacted", "2026-11-05T00:00:00Z"), now);
  assert.equal(quiet.reply, 0);
  assert.ok(quiet.rw > 0.3 && quiet.rw <= 0.6, `silence weight ${quiet.rw}`);
  assert.equal(SILENCE_DAYS, 7);
  function pick(o) { return { reply: o.reply, yes: o.yes }; }
});

test("no-reply teaches reachability, rejection teaches fit", () => {
  const mk = (id, role, stage, posting) => guest({ id, role, company: `C${id}`, industry: "Software", exp: "6 years", skills: ["Backend"], score: 60, stage, sig: { posting } });
  const all = [
    mk("a", "Senior Engineer", "Recorded", 9), mk("b", "Senior Engineer", "Accepted", 8),
    mk("c", "Senior Engineer", "Not responded", 1), mk("d", "Senior Engineer", "Not responded", 2),
    mk("e", "Director of Engineering", "Rejected", 9),
  ];
  const m = buildModel(all);
  const quietPoster = applyLearning(mk("x", "Senior Engineer", "Discovered", 1), m).learning;
  const activePoster = applyLearning(mk("y", "Senior Engineer", "Discovered", 9), m).learning;
  assert.ok(activePoster.adjust > quietPoster.adjust, `${activePoster.adjust} vs ${quietPoster.adjust}`);
  assert.ok(quietPoster.reasons.some((r) => r.q === "reply" && r.dir === "down"), "explains low reply chance");
  assert.ok(activePoster.replyChance > quietPoster.replyChance);
});

test("accuracy check compares AI-only ranking with learned ranking", () => {
  const s = scenario();
  const r = evaluate(s.all);
  assert.equal(r.yes, 2);
  assert.equal(r.no, 2);
  assert.ok(r.aiOnly >= 0 && r.aiOnly <= 100);
  assert.ok(r.withLearning >= 0 && r.withLearning <= 100);
});

// ---------- Native language: correct, add, learn ----------
import { applyLanguage, applyLanguageHints, hintsForPrompt, learnLanguageHints, surnameOf, swapHonorific } from "../lib/language.js";

const study = (lang, hon, conf = "Medium") => ({
  profile: { fullName: "Ravi Teja Kondapalli", firstName: "Ravi" },
  background: { nativeLanguage: lang, confidence: conf, signals: [] },
  honorific: hon,
  fullMessage: `Hi Ravi${hon ? " " + hon : ""},\n\nI'm Raghavendra…`,
  connectionNote: `Hi Ravi${hon ? " " + hon : ""}, I host…`,
  whatsappMessage: "", followUpMessage: "",
});

test("correcting the language updates greeting, honorific and messages", () => {
  const r = applyLanguage(study("Tamil", ""), "Telugu");
  assert.equal(r.background.nativeLanguage, "Telugu");
  assert.equal(r.background.confidence, "Confirmed");
  assert.equal(r.background.corrected, true);
  assert.equal(r.background.aiGuess, "Tamil");
  assert.equal(r.background.nativeGreeting, "Namaskaram");
  assert.equal(r.honorific, "garu");
  assert.match(r.fullMessage, /^Hi Ravi garu,/);
  assert.match(r.connectionNote, /^Hi Ravi garu, I host/);
  const back = applyLanguage(r, "Tamil");
  assert.match(back.fullMessage, /^Hi Ravi,/, "garu removed again");
  assert.equal(swapHonorific("Hi Ravi ji, hello", "Ravi", "ji", "garu"), "Hi Ravi garu, hello");
});

test("not sure / a new language / a hand-set honorific", () => {
  const notSure = applyLanguage(study("Telugu", "garu"), "");
  assert.equal(notSure.background.nativeLanguage, "Unknown");
  assert.match(notSure.fullMessage, /^Hi Ravi,/);
  const custom = applyLanguage(study("Unknown", ""), "Sindhi", { custom: true });
  assert.equal(custom.background.nativeLanguage, "Sindhi");
  assert.equal(custom.background.custom, true);
  const sir = applyLanguage(study("Hindi", "Sir"), "Telugu");
  assert.equal(sir.honorific, "Sir", "an honorific you set yourself is kept");
});

test("corrections teach future studies with the same surname", () => {
  assert.equal(surnameOf("K V Sandeep"), "", "initials are the family name, so nothing to learn from");
  assert.equal(surnameOf("Ravi Teja Kondapalli"), "kondapalli");
  const corrected = { name: "Sai Kondapalli", result: applyLanguage(study("Tamil", ""), "Telugu") };
  const hints = learnLanguageHints([corrected, { name: "No Outcome", result: study("Hindi", "ji") }]);
  assert.equal(hints.get("kondapalli").language, "Telugu");
  assert.equal(hints.size, 1, "unconfirmed guesses don't teach anything");
  const { result, used } = applyLanguageHints(study("Tamil", "", "Medium"), hints);
  assert.ok(used);
  assert.equal(result.background.nativeLanguage, "Telugu");
  assert.equal(result.background.learned, true);
  assert.equal(result.honorific, "garu");
  // A confident AI isn't overridden, but you're warned.
  const sure = applyLanguageHints(study("Tamil", "", "High"), hints);
  assert.equal(sure.result.background.nativeLanguage, "Tamil");
  assert.ok(sure.result.warnings.some((w) => /Check the language/.test(w)));
  assert.match(hintsForPrompt(hints), /Sai Kondapalli: not Tamil, Telugu/);
});

// ---------- YouTube episode stats ----------
import { addSnapshot, earlyViews, episodeVideoId, growth, isoSeconds, videoIdFrom, viewsByTrait } from "../lib/youtube.js";

test("YouTube links of every common shape give the video id", () => {
  for (const u of ["https://youtu.be/6qk1N1X6FaM", "youtu.be/6qk1N1X6FaM?si=abc", "https://www.youtube.com/watch?v=6qk1N1X6FaM&t=30", "https://youtube.com/shorts/6qk1N1X6FaM", "https://www.youtube.com/live/6qk1N1X6FaM"])
    assert.equal(videoIdFrom(u), "6qk1N1X6FaM", u);
  assert.equal(videoIdFrom("https://open.spotify.com/episode/x"), "");
  assert.equal(episodeVideoId({ links: { youtube: "youtu.be/6qk1N1X6FaM" } }), "6qk1N1X6FaM");
  assert.equal(episodeVideoId({ link: "https://youtu.be/6qk1N1X6FaM" }), "6qk1N1X6FaM", "older single link field");
  assert.equal(isoSeconds("PT1H2M3S"), 3723);
});

test("daily snapshots give weekly growth and first-week views", () => {
  let v = { publishedAt: "2026-11-01T10:00:00Z" };
  v = addSnapshot(v, { views: 100, likes: 5, comments: 1 }, "2026-11-02");
  v = addSnapshot(v, { views: 400, likes: 9, comments: 3 }, "2026-11-06");
  v = addSnapshot(v, { views: 450, likes: 9, comments: 3 }, "2026-11-06"); // same day: latest wins
  v = addSnapshot(v, { views: 900, likes: 20, comments: 7 }, "2026-11-12");
  assert.equal(v.snapshots.length, 3);
  assert.equal(v.views, 900);
  assert.deepEqual(growth(v, 7, "2026-11-12"), { views: 800, since: "2026-11-02" });
  assert.equal(earlyViews(v, 7), 450);
});

test("views by guest trait need 2+ episodes per group", () => {
  const row = (tags, views) => ({ g: { careerTags: tags }, v: { views } });
  const out = viewsByTrait([row(["Service → Product"], 3000), row(["Service → Product"], 1000), row([], 200), row([], 200)]);
  assert.equal(out[0].value, "Service → Product");
  assert.ok(out[0].times > 1.5);
});

// ---------- Production stages ----------
import { isRecorded, migrateStages as migrate2, PRODUCTION_STAGES } from "../lib/crm.js";

test("production stages: later stages still count as recorded; Published syncs the switch", () => {
  assert.deepEqual(PRODUCTION_STAGES, ["Accepted", "Scheduled", "Recorded", "Editing", "Ready to publish", "Published"]);
  const ed = applyStage(guest(), "Editing");
  assert.ok(ed.milestones.Recorded && ed.milestones.Accepted && ed.milestones.Scheduled);
  assert.ok(isRecorded(ed));
  assert.ok(ed.episode.recordedAt, "recording date filled in");
  const pub = applyStage(ed, "Published");
  assert.equal(pub.episode.published, true);
  assert.ok(pub.episode.publishedAt);
  const back = applyStage(pub, "Editing");
  assert.equal(back.episode.published, false);
  const cancelled = applyStage(applyStage(guest(), "Scheduled"), "Cancelled");
  assert.ok(cancelled.milestones.Accepted, "they still said yes");
  assert.ok(!isRecorded(cancelled));
  assert.equal(analytics([applyStage(guest(), "Published")]).inPipeline, 0);
});

test("existing recorded episodes marked published move to the Published stage", () => {
  const g = { ...applyStage(guest(), "Recorded"), episode: { recordedAt: "2026-11-08", published: true, publishedAt: "2026-11-10" } };
  const m = migrate2(g);
  assert.equal(m.stage, "Published");
  assert.ok(m.milestones.Recorded && m.milestones.Published);
  assert.equal(migrate2(applyStage(guest(), "Recorded")).stage, "Recorded", "unpublished stays Recorded");
});

test("finds the profile's own LinkedIn link in PDF text", async () => {
  const { findLinkedInUrl } = await import("../lib/pdfText.js");
  assert.equal(findLinkedInUrl("Contact www.linkedin.com/in/vishnu-chaparapu-1a2b (LinkedIn) … https://www.linkedin.com/in/vishnu-chaparapu-1a2b/ 1/4 … linkedin.com/in/someone-else"), "https://www.linkedin.com/in/vishnu-chaparapu-1a2b");
  assert.equal(findLinkedInUrl("no link here"), "");
});
