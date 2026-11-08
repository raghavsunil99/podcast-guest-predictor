// Structured career history and education: schema for the AI, plus calculations (durations,
// promotions, career moves) done in code so they're consistent and explainable.

// ---------- Schema (shared by profile study and the conversion of older guests) ----------
export const EXPERIENCE_SCHEMA = {
  type: "array",
  description: "Every job on the profile, one entry per COMPANY, most recent first. Group several roles at the same company into roles[].",
  items: {
    type: "object",
    properties: {
      company: { type: "string" },
      companyDomain: { type: "string", description: "Official website domain from well-known knowledge, e.g. 'infosys.com'; '' if unsure" },
      location: { type: "string", description: "City as stated, '' if not stated" },
      employmentType: { type: "string", enum: ["Full-time", "Internship", "Contract", "Freelance", "Part-time", "Self-employed", "Unknown"] },
      roles: {
        type: "array",
        description: "Roles at this company, most recent first",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            start: { type: "string", description: "'YYYY-MM' if the month is shown, else 'YYYY'; '' if not shown" },
            end: { type: "string", description: "'YYYY-MM', 'YYYY', 'Present' for a current role, or '' if not shown" },
          },
          required: ["title", "start", "end"],
        },
      },
    },
    required: ["company", "companyDomain", "location", "employmentType", "roles"],
  },
};

export const EDUCATION_SCHEMA = {
  type: "array",
  description: "Every college/university/school listed, most recent first",
  items: {
    type: "object",
    properties: {
      institution: { type: "string" },
      degree: { type: "string", description: "Degree only, e.g. 'B.Tech', 'MBA', 'M.Sc', 'Class XII'; '' if not stated" },
      field: { type: "string", description: "Branch / field of study, e.g. 'Electronics and Communication'; '' if not stated" },
      place: { type: "string", description: "City and state, e.g. 'Kakinada, Andhra Pradesh'. Use well-known knowledge of the institution if not stated." },
      years: { type: "string", description: "e.g. '2013–2017'; '' if not stated" },
      domain: { type: "string", description: "Institution website domain if well known, e.g. 'iitm.ac.in'; '' if unsure" },
      type: {
        type: "string",
        enum: ["IIT", "NIT", "IIIT", "IIM", "BITS", "Central university", "State university / govt college", "Private college / university", "International", "School", "Other"],
        description: "Best guess from well-known knowledge of the institution",
      },
    },
    required: ["institution", "degree", "field", "place", "years", "domain", "type"],
  },
};

export const CAREER_SWITCH_SCHEMA = {
  type: "string",
  description: "If the person changed field (e.g. Mechanical engineering → Data science, support → development, non-tech → tech), describe it in under 12 words; '' if their path stayed in one field.",
};

// ---------- Company groups used to label career moves ----------
const SERVICE = ["tcs", "tata consultancy", "infosys", "wipro", "cognizant", "hcl", "tech mahindra", "accenture", "capgemini", "ltimindtree", "mindtree", "l&t infotech", "lti", "mphasis", "hexaware", "persistent", "deloitte", "ibm", "genpact", "virtusa", "dxc", "ust", "ust global", "zensar", "birlasoft", "nttdata", "ntt data", "cgi", "syntel", "igate", "kpit", "coforge", "niit technologies", "sonata", "happiest minds", "ey", "kpmg", "pwc"];
const BIG_TECH = ["google", "microsoft", "amazon", "meta", "facebook", "apple", "netflix", "adobe", "salesforce", "oracle", "uber", "linkedin", "atlassian", "nvidia", "intel", "cisco", "walmart global tech", "goldman sachs", "jp morgan", "jpmorgan", "intuit", "paypal", "vmware", "sap", "qualcomm", "visa", "mastercard"];
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\b(pvt|private|ltd|limited|inc|llc|india|technologies|technology|services|solutions)\b/g, " ").replace(/\s+/g, " ").trim();
const inList = (name, list) => {
  const n = norm(name);
  return !!n && list.some((x) => n === x || n.startsWith(x + " ") || n.includes(" " + x + " ") || n.endsWith(" " + x));
};
export const isService = (c) => inList(c, SERVICE);
export const isBigTech = (c) => inList(c, BIG_TECH);

// ---------- Dates ----------
function parseDate(s, isEnd) {
  const v = String(s || "").trim();
  if (!v) return null;
  if (/present|current|now/i.test(v)) return { y: new Date().getFullYear(), m: new Date().getMonth() + 1, present: true };
  const m = v.match(/(\d{4})(?:[-/](\d{1,2}))?/);
  if (!m) return null;
  // Year only: assume roughly mid-year (Apr start / Sep end) so durations aren't overstated.
  return { y: Number(m[1]), m: m[2] ? Number(m[2]) : isEnd ? 9 : 4, approx: !m[2] };
}
const months = (a, b) => (a && b ? Math.max(0, (b.y - a.y) * 12 + (b.m - a.m) + 1) : null);

export function fmtMonths(n, approx) {
  if (n == null) return "";
  const y = Math.floor(n / 12), m = n % 12;
  const s = y && m ? `${y} yr ${m} mo` : y ? `${y} yr${y > 1 ? "s" : ""}` : `${m} mo`;
  return approx ? `~${s}` : s;
}

/** Durations, promotions and labels for one guest's experience list. */
export function analyzeCareer(experience = []) {
  const jobs = (experience || [])
    .filter((e) => e && e.company)
    .map((e) => {
      const roles = (e.roles || []).map((r) => {
        const a = parseDate(r.start, false), b = parseDate(r.end, true);
        return { ...r, from: a, to: b, months: months(a, b), approx: !!(a?.approx || b?.approx), current: !!b?.present };
      });
      const starts = roles.map((r) => r.from).filter(Boolean).sort((x, y) => x.y - y.y || x.m - y.m);
      const ends = roles.map((r) => r.to).filter(Boolean).sort((x, y) => y.y - x.y || y.m - x.m);
      const from = starts[0] || null, to = ends[0] || null;
      return {
        ...e,
        roles,
        from,
        to,
        months: months(from, to),
        approx: roles.some((r) => r.approx),
        current: roles.some((r) => r.current),
        promotions: Math.max(0, roles.length - 1),
        service: isService(e.company),
        bigTech: isBigTech(e.company),
        intern: e.employmentType === "Internship",
      };
    });

  // Most recent first, like LinkedIn: current jobs on top, then by end date, then start date.
  const key = (d) => (d ? d.y * 12 + d.m : -1);
  const newestFirst = (a, b) => (b.current - a.current) || key(b.to) - key(a.to) || key(b.from) - key(a.from);
  for (const j of jobs) j.roles.sort(newestFirst);
  jobs.sort(newestFirst);

  const work = jobs.filter((j) => !j.intern);
  // Total experience from the union of dated periods (no double counting of overlaps).
  const spans = work.filter((j) => j.from && j.to).map((j) => [j.from.y * 12 + j.from.m, j.to.y * 12 + j.to.m]).sort((a, b) => a[0] - b[0]);
  let total = 0, cur = null;
  for (const [s, e] of spans) {
    if (!cur || s > cur[1] + 1) { if (cur) total += cur[1] - cur[0] + 1; cur = [s, e]; } else cur[1] = Math.max(cur[1], e);
  }
  if (cur) total += cur[1] - cur[0] + 1;
  const dated = work.filter((j) => j.months != null);

  const moves = [];
  const chrono = [...work].reverse(); // oldest first
  for (let i = 1; i < chrono.length; i++) {
    const a = chrono[i - 1], b = chrono[i];
    if (a.service && !b.service) moves.push({ type: "Service → Product", text: `${a.company} → ${b.company}` });
    if (!a.bigTech && b.bigTech) moves.push({ type: "Into Big Tech", text: `${a.company} → ${b.company}` });
  }
  const promotionsTotal = work.reduce((t, j) => t + j.promotions, 0);
  const tags = [];
  if (moves.some((m) => m.type === "Service → Product")) tags.push("Service → Product");
  if (moves.some((m) => m.type === "Into Big Tech")) tags.push("Into Big Tech");
  if (promotionsTotal) tags.push(`Promoted ${promotionsTotal}×`);
  if (work.length === 1 && dated[0]?.months >= 36) tags.push("Long tenure");

  return {
    jobs,
    totalMonths: spans.length ? total : null,
    approx: dated.some((j) => j.approx),
    companies: work.length,
    avgTenureMonths: dated.length ? Math.round(dated.reduce((t, j) => t + j.months, 0) / dated.length) : null,
    promotions: promotionsTotal,
    moves,
    tags,
    pastCompanies: work.filter((j) => !j.current).map((j) => j.company),
  };
}

export const hasStructuredCareer = (g) => Array.isArray(g?.result?.profile?.experience) && g.result.profile.experience.length > 0;
