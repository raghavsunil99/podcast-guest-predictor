// Fills a separate data folder with FICTIONAL guests for screenshots and demos.
// Never touches your real data/ folder.
//   DATA_DIR=demo-data node --env-file=.env.local scripts/seed-demo.mjs
import { promises as fs } from "fs";
import path from "path";
import { scoreAcceptance } from "../lib/scoring.js";
import { activity, applyStage, guestFromResult } from "../lib/crm.js";
import { encrypt } from "../lib/ai/secrets.js";

const DIR = path.resolve(process.env.DATA_DIR || "demo-data");
if (path.basename(DIR) === "data") throw new Error("Refusing to seed into the real data folder.");
const DAY = 86400000;
const ago = (d, h = 10) => new Date(Date.now() - d * DAY + h * 3600000).toISOString();

const job = (company, companyDomain, roles, employmentType = "Full-time", location = "") => ({ company, companyDomain, location, employmentType, roles });
const r = (title, start, end) => ({ title, start, end });
const edu = (institution, degree, field, place, years, type, domain = "") => ({ institution, degree, field, place, years, domain, type });

const PEOPLE = [
  {
    name: "Ananya Iyer", role: "Senior Data Scientist", company: "Swiggy", domain: "swiggy.in", industry: "Food tech", city: "Bengaluru", lang: ["Tamil", "Tamil Nadu", "Vanakkam", "High"],
    exp: [job("Swiggy", "swiggy.in", [r("Senior Data Scientist", "2023-04", "Present"), r("Data Scientist", "2021-02", "2023-03")]), job("Infosys", "infosys.com", [r("Systems Engineer", "2017-07", "2021-01")])],
    edu: [edu("PSG College of Technology", "B.E.", "Mechanical Engineering", "Coimbatore, Tamil Nadu", "2013–2017", "Private college / university", "psgtech.edu")],
    sw: "Mechanical engineering → data science", followers: "12,800 followers", posting: "Frequent", speaking: "Strong",
    c: { audience: 10, posting: 9, speaking: 8, mentoring: 9, story: 10, accessibility: 8 }, stage: "Recorded", days: 30,
    hook: "a self-taught move from mechanical engineering at Infosys to building ML models at Swiggy", skills: ["Python", "Machine Learning", "Forecasting"],
  },
  {
    name: "Rohit Deshpande", role: "Engineering Manager", company: "Razorpay", domain: "razorpay.com", industry: "Fintech", city: "Bengaluru", lang: ["Marathi", "Maharashtra", "Namaskar", "High"],
    exp: [job("Razorpay", "razorpay.com", [r("Engineering Manager", "2022-10", "Present"), r("Senior Software Engineer", "2020-01", "2022-09")]), job("TCS", "tcs.com", [r("Assistant Systems Engineer", "2015-08", "2019-12")])],
    edu: [edu("College of Engineering Pune", "B.Tech", "Computer Engineering", "Pune, Maharashtra", "2011–2015", "State university / govt college", "coep.org.in")],
    sw: "", followers: "8,900 followers", posting: "Frequent", speaking: "Some",
    c: { audience: 8, posting: 9, speaking: 6, mentoring: 8, story: 9, accessibility: 7 }, stage: "Accepted", days: 18,
    hook: "growing from a TCS service role to leading a payments team at Razorpay", skills: ["Payments", "System Design", "Java"],
  },
  {
    name: "Sravani Reddy", role: "Product Designer", company: "Microsoft", domain: "microsoft.com", industry: "Software", city: "Hyderabad", lang: ["Telugu", "Andhra Pradesh / Telangana", "Namaskaram", "High"],
    exp: [job("Microsoft", "microsoft.com", [r("Product Designer II", "2023-06", "Present"), r("Product Designer", "2021-08", "2023-05")]), job("Zomato", "zomato.com", [r("UX Designer", "2019-06", "2021-07")])],
    edu: [edu("JNTU Kakinada", "B.Tech", "Electronics and Communication", "Kakinada, Andhra Pradesh", "2015–2019", "State university / govt college", "jntuk.edu.in")],
    sw: "Electronics engineering → product design", followers: "6,400 followers", posting: "Occasional", speaking: "Some",
    c: { audience: 8, posting: 6, speaking: 6, mentoring: 7, story: 9, accessibility: 8 }, stage: "Responded", days: 12,
    hook: "switching from electronics engineering to designing products at Microsoft", skills: ["Figma", "UX Research", "Design Systems"],
  },
  {
    name: "Karan Malhotra", role: "Software Engineer II", company: "Atlassian", domain: "atlassian.com", industry: "Software", city: "Bengaluru", lang: ["Punjabi", "Punjab", "Sat Sri Akal", "Medium"],
    exp: [job("Atlassian", "atlassian.com", [r("Software Engineer II", "2022-03", "Present")]), job("Wipro", "wipro.com", [r("Project Engineer", "2019-07", "2022-02")])],
    edu: [edu("Thapar Institute of Engineering and Technology", "B.E.", "Computer Science", "Patiala, Punjab", "2015–2019", "Private college / university", "thapar.edu")],
    sw: "", followers: "3,100 followers", posting: "Occasional", speaking: "None found",
    c: { audience: 7, posting: 6, speaking: 4, mentoring: 6, story: 8, accessibility: 9 }, stage: "Contacted", days: 9, contactedDaysAgo: 7,
    hook: "moving from a Wipro service role to product engineering at Atlassian", skills: ["Java", "Distributed Systems", "AWS"],
  },
  {
    name: "Fathima Rahman", role: "Engineering Lead", company: "Zoho", domain: "zoho.com", industry: "SaaS", city: "Chennai", lang: ["Malayalam", "Kerala", "Namaskaram", "High"],
    exp: [job("Zoho", "zoho.com", [r("Engineering Lead", "2021-01", "Present"), r("Member Technical Staff", "2016-06", "2020-12")])],
    edu: [edu("Government Engineering College Thrissur", "B.Tech", "Computer Science", "Thrissur, Kerala", "2012–2016", "State university / govt college", "gectcr.ac.in")],
    sw: "", followers: "15,200 followers", posting: "Frequent", speaking: "Strong",
    c: { audience: 10, posting: 9, speaking: 9, mentoring: 9, story: 7, accessibility: 7 }, stage: "Shortlisted", days: 6,
    hook: "nine years of growth inside Zoho, from Member Technical Staff to Engineering Lead", skills: ["Java", "Leadership", "Mentoring"],
  },
  {
    name: "Arjun Gowda", role: "Senior SDE", company: "Amazon", domain: "amazon.com", industry: "E-commerce", city: "Bengaluru", lang: ["Kannada", "Karnataka", "Namaskara", "High"],
    exp: [job("Amazon", "amazon.com", [r("Senior SDE", "2023-01", "Present"), r("SDE II", "2020-04", "2022-12")]), job("Flipkart", "flipkart.com", [r("SDE I", "2018-07", "2020-03")])],
    edu: [edu("National Institute of Technology Karnataka", "B.Tech", "Information Technology", "Surathkal, Karnataka", "2014–2018", "NIT", "nitk.ac.in")],
    sw: "", followers: "2,300 followers", posting: "Rare", speaking: "None found",
    c: { audience: 7, posting: 3, speaking: 3, mentoring: 5, story: 6, accessibility: 6 }, stage: "Discovered", days: 3,
    hook: "rising from SDE I at Flipkart to Senior SDE at Amazon in five years", skills: ["Java", "AWS", "Microservices"],
  },
  {
    name: "Priyanka Sharma", role: "VP Engineering", company: "PhonePe", domain: "phonepe.com", industry: "Fintech", city: "Bengaluru", lang: ["Hindi", "Uttar Pradesh", "Namaste", "Medium"],
    exp: [job("PhonePe", "phonepe.com", [r("VP Engineering", "2021-05", "Present")]), job("Google", "google.com", [r("Engineering Manager", "2015-02", "2021-04")]), job("Adobe", "adobe.com", [r("Member of Technical Staff", "2009-07", "2015-01")])],
    edu: [edu("Indian Institute of Technology Kanpur", "B.Tech", "Computer Science", "Kanpur, Uttar Pradesh", "2005–2009", "IIT", "iitk.ac.in")],
    sw: "", followers: "41,000 followers", posting: "Occasional", speaking: "Strong",
    c: { audience: 10, posting: 6, speaking: 9, mentoring: 6, story: 6, accessibility: 3 }, stage: "Rejected", days: 22,
    hook: "leading payments engineering at PhonePe after a decade at Google and Adobe", skills: ["Leadership", "Scale", "Payments"],
  },
  {
    name: "Vikram Rao", role: "Data Engineer", company: "Freshworks", domain: "freshworks.com", industry: "SaaS", city: "Chennai", lang: ["Telugu", "Andhra Pradesh", "Namaskaram", "Medium"],
    exp: [job("Freshworks", "freshworks.com", [r("Data Engineer", "2022-08", "Present")]), job("Cognizant", "cognizant.com", [r("Programmer Analyst", "2019-09", "2022-07")])],
    edu: [edu("Sri Venkateswara University", "B.Tech", "Civil Engineering", "Tirupati, Andhra Pradesh", "2015–2019", "State university / govt college")],
    sw: "Civil engineering → data engineering", followers: "1,900 followers", posting: "Occasional", speaking: "Some",
    c: { audience: 6, posting: 6, speaking: 6, mentoring: 7, story: 9, accessibility: 9 }, stage: "Discovered", days: 2,
    hook: "switching from civil engineering to data engineering at Freshworks", skills: ["Spark", "SQL", "Airflow"],
  },
  {
    name: "Nikhil Joshi", role: "Senior Frontend Engineer", company: "CRED", domain: "cred.club", industry: "Fintech", city: "Bengaluru", lang: ["Gujarati", "Gujarat", "Kem cho", "Medium"],
    exp: [job("CRED", "cred.club", [r("Senior Frontend Engineer", "2023-02", "Present")]), job("HCL Technologies", "hcltech.com", [r("Software Engineer", "2018-07", "2023-01")])],
    edu: [edu("Nirma University", "B.Tech", "Computer Engineering", "Ahmedabad, Gujarat", "2014–2018", "Private college / university", "nirmauni.ac.in")],
    sw: "", followers: "4,700 followers", posting: "Frequent", speaking: "Some",
    c: { audience: 7, posting: 9, speaking: 6, mentoring: 6, story: 7, accessibility: 8 }, stage: "Contact later", days: 14,
    hook: "moving from HCL services to building consumer fintech at CRED", skills: ["React", "TypeScript", "Animation"],
  },
  {
    name: "Divya Krishnan", role: "ML Engineer", company: "Google", domain: "google.com", industry: "Software", city: "Hyderabad", lang: ["Tamil", "Tamil Nadu", "Vanakkam", "High"],
    exp: [job("Google", "google.com", [r("ML Engineer", "2022-01", "Present")]), job("Tata Consultancy Services", "tcs.com", [r("Systems Engineer", "2018-06", "2021-12")])],
    edu: [edu("Anna University", "B.E.", "Electrical and Electronics", "Chennai, Tamil Nadu", "2014–2018", "State university / govt college", "annauniv.edu")],
    sw: "Electrical engineering → machine learning", followers: "9,600 followers", posting: "Frequent", speaking: "Strong",
    c: { audience: 8, posting: 9, speaking: 8, mentoring: 8, story: 10, accessibility: 7 }, stage: "Discovered", days: 1,
    hook: "a TCS systems engineer who taught herself ML and joined Google", skills: ["TensorFlow", "NLP", "Python"],
  },
  {
    name: "Sameer Khan", role: "DevOps Engineer", company: "Postman", domain: "postman.com", industry: "Developer tools", city: "Bengaluru", lang: ["Urdu", "Hyderabad, Telangana", "Adaab", "Low"],
    exp: [job("Postman", "postman.com", [r("DevOps Engineer", "2021-09", "Present")]), job("Mphasis", "mphasis.com", [r("Associate Engineer", "2019-01", "2021-08")])],
    edu: [edu("Osmania University", "B.E.", "Information Technology", "Hyderabad, Telangana", "2014–2018", "State university / govt college", "osmania.ac.in")],
    sw: "", followers: "Unknown", posting: "Unknown", speaking: "None found",
    c: { audience: null, posting: null, speaking: null, mentoring: null, story: 7, accessibility: 8 }, stage: "Not responded", days: 25,
    hook: "moving from Mphasis support to running infrastructure at Postman", skills: ["Kubernetes", "Terraform", "CI/CD"],
  },
  {
    name: "Aditi Kulkarni", role: "Product Manager", company: "Flipkart", domain: "flipkart.com", industry: "E-commerce", city: "Bengaluru", lang: ["Marathi", "Maharashtra", "Namaskar", "High"],
    exp: [job("Flipkart", "flipkart.com", [r("Product Manager", "2022-04", "Present"), r("Associate Product Manager", "2020-07", "2022-03")]), job("Accenture", "accenture.com", [r("Business Analyst", "2017-07", "2020-06")])],
    edu: [edu("Indian Institute of Management Indore", "MBA", "Marketing and Product", "Indore, Madhya Pradesh", "2018–2020", "IIM", "iimidr.ac.in"), edu("VIT Pune", "B.Tech", "Computer Engineering", "Pune, Maharashtra", "2013–2017", "Private college / university")],
    sw: "Business analysis → product management", followers: "7,300 followers", posting: "Occasional", speaking: "Some",
    c: { audience: 8, posting: 6, speaking: 6, mentoring: 8, story: 8, accessibility: 8 }, stage: "Recorded", days: 40,
    hook: "going from an Accenture business analyst to product manager at Flipkart", skills: ["Product Strategy", "Analytics", "Growth"],
  },
];

function resultFor(p) {
  const [first] = p.name.split(" ");
  const criteria = Object.entries(p.c).map(([id, score]) => ({ id, score: score ?? 5, found: score != null, evidence: score != null ? "From the profile" : "Not shown in the profile" }));
  const honor = p.lang[0] === "Telugu" ? "garu" : ["Hindi", "Marathi", "Gujarati", "Punjabi"].includes(p.lang[0]) ? "ji" : "";
  const hi = `Hi ${first}${honor ? " " + honor : ""},`;
  const res = {
    profile: {
      fullName: p.name, firstName: first, currentRole: p.role, currentCompany: p.company, companyDomain: p.domain, industry: p.industry, photoUrl: "",
      location: `${p.city}, India`, currentCity: p.city, education: p.edu, experience: p.exp, careerSwitch: p.sw,
      totalExperience: "", careerPath: [], skills: p.skills, domain: p.skills[0],
      aboutSummary: `${p.role} at ${p.company}. Known for ${p.hook}. Shares practical career advice for students and early-career engineers.`,
    },
    background: { nativeLanguage: p.lang[0], nativeRegion: p.lang[1], confidence: p.lang[3], nativeGreeting: p.lang[2], signals: [`Surname ${p.name.split(" ")[1]} is common in ${p.lang[1]}`, `Studied at ${p.edu[0].institution} (${p.edu[0].place})`] },
    socialSignals: { followers: p.followers, connections: "500+ connections", postingActivity: p.posting, postingEvidence: "", publicSpeaking: p.speaking, speakingEvidence: [] },
    acceptance: { criteria, summary: `Strong fit: ${p.hook}.`, tips: ["Mention their journey in the first line", "Engage with a recent post before sending the invite", "Offer a flexible weekend slot"] },
    contact: { email: `${first.toLowerCase()}@example.com`, phone: "", website: "" },
    hook: p.hook,
    honorific: honor,
    honorificReason: honor ? `Likely ${p.lang[0]} speaker` : "Uses first name",
    fullMessage: `${hi}\n\nHope you're doing well!\n\nI'm Raghavendra, Academic Head at Entri and a content creator. I host the Entri Podcast, where industry professionals share their career journeys with students and aspiring tech professionals.\n\nYour journey caught my attention, especially ${p.hook}. Many of our learners are trying to make a similar move, and your experience in ${p.skills[0]} would add a lot to the conversation.\n\nI'd love to invite you for a casual 30–45 minute conversation (online, at a time that suits you).\n\nWould you be open to joining us?\n\nWarm regards,\nRaghavendra`,
    connectionNote: `${hi} I'm Raghavendra from Entri. I host the Entri Podcast on career journeys. Your story of ${p.hook.slice(0, 80)} would inspire many freshers. Open to a 30-min chat?`.slice(0, 300),
    whatsappMessage: `${hi} Raghavendra here from Entri 👋 I host the Entri Podcast. Would love to have you share your journey (${p.hook}) with our students. 30–45 min online, whenever suits you. Interested?`,
    followUpMessage: `${hi} just following up on my podcast invite. No pressure at all; happy to work around your schedule if you're interested.`,
    personalizationNotes: [`Used their move: ${p.hook}`, `Skill highlighted: ${p.skills[0]}`],
    warnings: [],
    model: "demo",
    tokensUsed: 0,
  };
  scoreAcceptance(res);
  return res;
}

const guests = [];
let i = 0;
for (const p of PEOPLE) {
  const created = ago(p.days, 9);
  const result = resultFor(p);
  let g = {
    id: `demo${String(++i).padStart(2, "0")}`,
    createdAt: created,
    updatedAt: created,
    ...guestFromResult(result, { url: `https://www.linkedin.com/in/${p.name.toLowerCase().replace(/\s+/g, "-")}-demo` }),
    contactSource: { email: "profile" },
    stage: "Discovered",
    milestones: { Discovered: created },
    notes: [],
    episode: {},
    activity: [activity("created", `Discovered · prediction ${result.acceptance.score}/100`, created)],
  };
  if (p.stage !== "Discovered") {
    const when = p.contactedDaysAgo != null ? ago(p.contactedDaysAgo) : ago(Math.max(0, p.days - 3));
    g = applyStage(g, p.stage, when);
  }
  if (p.stage === "Recorded") g.episode = { title: `${p.name.split(" ")[0]} on ${p.hook.split(" ").slice(0, 6).join(" ")}…`, recordedAt: ago(p.days - 10).slice(0, 10), link: "https://youtube.com" };
  if (["Accepted", "Responded", "Recorded"].includes(p.stage)) {
    g.notes = [{ id: `n${i}`, t: ago(Math.max(0, p.days - 4)), text: "Replied on LinkedIn. Prefers weekend evenings; interested in talking about career switches." }];
    g.activity.unshift(activity("note", g.notes[0].text, g.notes[0].t));
  }
  g.updatedAt = g.activity[0].t;
  guests.push(g);
}

// Seven days of API usage across two providers
const usage = [];
const day = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(Date.now() - d * DAY));
[4, 7, 3, 9, 6, 11, 8].forEach((count, k) => {
  for (let j = 0; j < count; j++) {
    const prov = j % 4 === 3 ? "anthropic-demo" : "gemini-demo";
    const ok = !(k === 5 && j === 2);
    usage.push({ t: new Date(Date.now() - (6 - k) * DAY).toISOString(), day: day(6 - k), provider: prov, providerType: prov.split("-")[0], model: prov.startsWith("gemini") ? "gemini-3.5-flash" : "claude-haiku-5-5", kind: j % 3 ? "generate" : "recommend", ok, input: 2400, output: 900, total: 3300, ...(ok ? {} : { errorType: "rate", error: "Per-minute rate limit reached" }) });
  }
});

const providers = {
  providers: [
    { id: "gemini-demo", type: "gemini", name: "Google Gemini", enabled: true, priority: 1, model: "gemini-3.5-flash", fallbackModels: ["gemini-3.5-flash-lite"], keyEnc: await encrypt("demo-key-not-real-a1b2"), keyHint: "…a1b2", dailyLimit: 250, warnAt: 80 },
    { id: "anthropic-demo", type: "anthropic", name: "Anthropic Claude", enabled: true, priority: 2, model: "claude-haiku-5-5", fallbackModels: [], keyEnc: await encrypt("demo-key-not-real-c3d4"), keyHint: "…c3d4", dailyLimit: 100, warnAt: 80 },
    { id: "openai-demo", type: "openai", name: "OpenAI", enabled: false, priority: 3, model: "gpt-5-mini", fallbackModels: [], keyEnc: await encrypt("demo-key-not-real-e5f6"), keyHint: "…e5f6", dailyLimit: null, warnAt: 80 },
  ],
};
const status = {
  "gemini-demo": { lastOkAt: ago(0, 1), lastModel: "gemini-3.5-flash" },
  "anthropic-demo": { lastOkAt: ago(1), lastModel: "claude-haiku-5-5", rateLimit: { requestsRemaining: 48, requestsLimit: 50, at: ago(1) } },
};
const recommendations = {
  focus: "Guests with a clear career switch or a service-to-product move say yes most often. Prioritise mid-level engineers and designers (5–10 years) who mentor or post regularly.",
  companiesToExplore: [
    { name: "Meesho", domain: "meesho.com", industry: "E-commerce", why: "Many engineers who moved from IT services into product roles.", rolesToLookFor: ["SDE II", "Data Scientist"] },
    { name: "Groww", domain: "groww.in", industry: "Fintech", why: "Young teams with relatable journeys from tier-2 colleges.", rolesToLookFor: ["Backend Engineer", "Product Designer"] },
    { name: "Juspay", domain: "juspay.in", industry: "Fintech", why: "Known for hiring and mentoring freshers into strong engineers.", rolesToLookFor: ["Software Engineer", "Engineering Manager"] },
    { name: "BrowserStack", domain: "browserstack.com", industry: "Developer tools", why: "Engineers who actively speak at meetups and write blogs.", rolesToLookFor: ["DevOps Engineer", "Developer Advocate"] },
  ],
  highConcentration: [
    { name: "Infosys", domain: "infosys.com", why: "Large pool of engineers who later moved to product companies." },
    { name: "TCS", domain: "tcs.com", why: "Common first job for many self-taught career switchers." },
  ],
  profileIdeas: [
    { title: "Mechanical engineers turned data scientists", why: "Matches your most successful episodes.", searchKeywords: "data scientist mechanical engineering" },
    { title: "Designers from non-design degrees", why: "Relatable for students unsure about their branch.", searchKeywords: "product designer electronics engineering" },
  ],
  generatedAt: ago(0, 2), model: "gemini-3.5-flash", provider: "Google Gemini", basedOn: guests.length, outcomesUsed: 5,
};

await fs.rm(DIR, { recursive: true, force: true });
await fs.mkdir(DIR, { recursive: true });
const write = (name, v) => fs.writeFile(path.join(DIR, `${name}.json`), JSON.stringify(v, null, 2));
await write("guests", guests);
await write("usage", usage);
await write("providers", providers);
await write("provider-status", status);
await write("recommendations", recommendations);
await write("recommendation-feedback", { "company:Juspay": "relevant" });
console.log(`Demo data: ${guests.length} fictional guests in ${DIR}`);
