// AI recommendations: companies and profile types worth exploring, based on the guest
// pipeline so far. The last result is cached in data/recommendations.json.
import { readDoc, writeDoc } from "@/lib/db";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import { aiErrorResponse, runAI } from "@/lib/ai/service";
import { listGuests } from "@/lib/guestStore";
import { companyKey, groupCompanies, normText } from "@/lib/crm";
import { buildModel, outcomeOf, successProfile } from "@/lib/learning";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const readFeedback = () => readDoc("recommendation-feedback", {});

const SCHEMA = {
  type: "object",
  properties: {
    focus: { type: "string", description: "Two sentences: what kind of guest to prioritise next, given what has worked so far" },
    companiesToExplore: {
      type: "array",
      description: "6 companies with offices in India NOT in the explored list, where many people match the guest criteria",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          domain: { type: "string", description: "Official website domain, e.g. 'zerodha.com'" },
          industry: { type: "string" },
          why: { type: "string", description: "One sentence on why their people suit this podcast" },
          rolesToLookFor: { type: "array", items: { type: "string" }, description: "2–3 job titles to search for there" },
        },
        required: ["name", "domain", "industry", "why", "rolesToLookFor"],
      },
    },
    highConcentration: {
      type: "array",
      description: "4 companies (explored or not) known for a high concentration of professionals who match the guest criteria, e.g. many career switchers or alumni of tier-2/3 colleges",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          domain: { type: "string" },
          why: { type: "string" },
        },
        required: ["name", "domain", "why"],
      },
    },
    profileIdeas: {
      type: "array",
      description: "5 specific kinds of profiles to search for on LinkedIn next (archetypes, not named people)",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "e.g. 'Mechanical engineers turned data scientists'" },
          why: { type: "string" },
          searchKeywords: { type: "string", description: "LinkedIn people-search keywords, e.g. 'data scientist mechanical engineering'" },
        },
        required: ["title", "why", "searchKeywords"],
      },
    },
  },
  required: ["focus", "companiesToExplore", "highConcentration", "profileIdeas"],
};

export async function GET() {
  const feedback = await readFeedback();
  const saved = await readDoc("recommendations", null);
  return Response.json(saved ? { ...saved, feedback } : { empty: true, feedback });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const settings = { ...DEFAULT_SETTINGS, ...(body.settings || {}) };

  const guests = await listGuests();
  const companies = groupCompanies(guests);
  const model = buildModel(guests);
  const profile = successProfile(model);
  const feedback = await readFeedback();
  const describe = (g) =>
    `- ${g.role || "?"} at ${g.company || "?"} (${g.domain || g.industry || "?"}, ${g.experience || "? experience"}${g.pastCompanies?.length ? `, previously ${g.pastCompanies.slice(0, 4).join(", ")}` : ""}${g.colleges?.length ? `, studied at ${g.colleges[0]}` : ""}${g.careerTags?.length ? `, ${g.careerTags.join(", ")}` : ""}), outcome: ${outcomeOf(g)?.label || g.stage}${g.result?.hook ? `; story: ${g.result.hook}` : ""}`;
  const yes = guests.filter((g) => outcomeOf(g)?.y === 1 && outcomeOf(g).w >= 0.6);
  const no = guests.filter((g) => outcomeOf(g)?.y === 0 && outcomeOf(g).w >= 0.6);
  const fb = (kind, val) => Object.entries(feedback).filter(([k, v]) => k.startsWith(kind + ":") && v === val).map(([k]) => k.slice(kind.length + 1));

  const prompt = `You help ${settings.senderName} (${settings.senderRole}) find guests for the ${settings.podcastName}, where ${settings.podcastAbout}.

What makes a great guest: ${settings.guestCriteria}

Guests who ACCEPTED or RECORDED (learn from these individual profiles, not just their companies):
${yes.slice(0, 15).map(describe).join("\n") || "- none yet"}

Guests who REJECTED or never replied:
${no.slice(0, 10).map(describe).join("\n") || "- none yet"}

Traits most common among guests who said yes:
${profile.traits.map((t) => `- ${t.trait}: ${t.value} (${t.yes} of ${t.total} said yes)`).join("\n") || "- not enough outcomes yet"}

Companies already explored (do NOT suggest these in companiesToExplore):
${companies.map((c) => `- ${c.name} (${c.guests} guests, ${c.contacted} contacted, ${c.recorded} recorded)`).join("\n") || "- none yet"}

Feedback from the host on earlier suggestions:
- Relevant: ${[...fb("company", "relevant"), ...fb("profile", "relevant")].join(", ") || "none"}
- Not relevant (avoid similar ones): ${[...fb("company", "irrelevant"), ...fb("profile", "irrelevant")].join(", ") || "none"}

Suggest where to find more people like the guests who said yes, at OTHER companies. Prefer companies with a strong presence in India. Be concrete and practical. Do not name individual people.`;

  try {
    const out = await runAI({ kind: "recommend", parts: [{ text: prompt }], schema: SCHEMA, temperature: 0.8 });
    const data = out.data;
    const explored = new Set(guests.map(companyKey).filter(Boolean));
    const known = new Set(guests.map((g) => normText(g.company)).filter(Boolean));
    data.companiesToExplore = (data.companiesToExplore || []).filter(
      (c) => !explored.has(companyKey({ company: c.name, companyDomain: c.domain })) && !known.has(normText(c.name))
    );
    const saved = { ...data, generatedAt: new Date().toISOString(), model: out.model, provider: out.provider.name, basedOn: guests.length, outcomesUsed: yes.length + no.length };
    await writeDoc("recommendations", saved);
    return Response.json({ ...saved, feedback, notice: out.notice });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
