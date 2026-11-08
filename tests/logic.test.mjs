// Unit tests for the pure logic: scoring, CRM stages, career calculations, learning.
// Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { scoreAcceptance, applyManualSignals, parseCount } from "../lib/scoring.js";
import { applyStage, analytics, findDuplicates, followUpsDue, guestFromResult, migrateStages, toCSV, tierOf } from "../lib/crm.js";
import { analyzeCareer, fmtMonths, isService, isBigTech } from "../lib/career.js";
import { buildModel, applyLearning, nextBest, similarProfiles, outcomeOf } from "../lib/learning.js";
import { parseJSON, strictSchema } from "../lib/ai/schema.js";

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
  assert.equal(a.inPipeline, 2);
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
