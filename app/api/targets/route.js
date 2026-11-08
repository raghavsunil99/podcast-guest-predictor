// Target companies: AI suggestions of companies to find guests at, and the companies you pin
// and track. Stored as one document ("targets") in the database or data/targets.json.
import { readDoc, writeDoc } from "@/lib/db";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import { aiErrorResponse, runAI } from "@/lib/ai/service";
import { listGuests } from "@/lib/guestStore";
import { groupCompanies } from "@/lib/crm";
import { buildModel, outcomeOf, successProfile } from "@/lib/learning";
import { CATEGORIES, SIZES, TARGET_STATUSES, cleanSuggestions, targetKey, trackTargets } from "@/lib/targets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EMPTY = { suggestions: null, pinned: [], dismissed: [] };
const load = async () => ({ ...EMPTY, ...(await readDoc("targets", EMPTY)) });

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One or two sentences: the pattern behind these picks" },
    companies: {
      type: "array",
      description: "10 companies with offices in India, best fit first",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          domain: { type: "string", description: "Official website domain, e.g. 'zerodha.com'" },
          industry: { type: "string", description: "Short label, e.g. 'Fintech', 'SaaS', 'E-commerce'" },
          category: { type: "string", enum: CATEGORIES },
          size: { type: "string", enum: SIZES },
          fitScore: { type: "integer", description: "0–100: how likely this company has people who match the guest criteria AND would say yes, judged from the guests who accepted" },
          why: { type: "string", description: "One sentence, specific to this podcast's past guests" },
          indiaCities: { type: "array", items: { type: "string" }, description: "1–3 Indian cities with big offices" },
          roles: { type: "array", items: { type: "string" }, description: "2–3 job titles to search for there" },
          similarTo: { type: "string", description: "One company from the host's existing guests that this resembles, or empty" },
        },
        required: ["name", "domain", "industry", "category", "size", "fitScore", "why", "indiaCities", "roles", "similarTo"],
      },
    },
  },
  required: ["summary", "companies"],
};

async function view() {
  const [doc, guests] = await Promise.all([load(), listGuests()]);
  return { ...doc, pinned: trackTargets(doc.pinned, guests) };
}

export async function GET() {
  return Response.json(await view());
}

// { action: "suggest", filters, settings } | { action: "pin", company } | { action: "status", key, status }
// | { action: "unpin", key } | { action: "dismiss", key }
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const doc = await load();

  if (body.action === "pin" && body.company?.name) {
    const c = body.company;
    const key = targetKey(c.name, c.domain);
    if (!doc.pinned.some((t) => t.key === key)) {
      doc.pinned.unshift({
        key, name: c.name, domain: c.domain || "", industry: c.industry || "", category: c.category || "Other", size: c.size || "",
        fitScore: c.fitScore ?? null, why: c.why || "", roles: c.roles || [], indiaCities: c.indiaCities || [],
        status: "Target", addedAt: new Date().toISOString(),
      });
    }
    await writeDoc("targets", doc);
    return Response.json(await view());
  }
  if (body.action === "status" && TARGET_STATUSES.includes(body.status)) {
    doc.pinned = doc.pinned.map((t) => (t.key === body.key ? { ...t, status: body.status } : t));
    await writeDoc("targets", doc);
    return Response.json(await view());
  }
  if (body.action === "unpin") {
    doc.pinned = doc.pinned.filter((t) => t.key !== body.key);
    await writeDoc("targets", doc);
    return Response.json(await view());
  }
  if (body.action === "dismiss" && body.key) {
    doc.dismissed = [...new Set([...(doc.dismissed || []), body.key])].slice(-200);
    if (doc.suggestions) doc.suggestions.items = doc.suggestions.items.filter((c) => c.key !== body.key);
    await writeDoc("targets", doc);
    return Response.json(await view());
  }

  if (body.action !== "suggest") return Response.json({ error: "Unknown action." }, { status: 400 });

  const settings = { ...DEFAULT_SETTINGS, ...(body.settings || {}) };
  const f = body.filters || {};
  const guests = await listGuests();
  const companies = groupCompanies(guests);
  const profile = successProfile(buildModel(guests));
  const yes = guests.filter((g) => outcomeOf(g)?.y === 1);
  const no = guests.filter((g) => outcomeOf(g)?.y === 0);
  const line = (g) => `- ${g.role || "?"} at ${g.company || "?"}${g.industry ? ` (${g.industry})` : ""}${g.pastCompanies?.length ? `, previously ${g.pastCompanies.slice(0, 3).join(", ")}` : ""}${g.careerTags?.length ? `, ${g.careerTags.join(", ")}` : ""}${g.language ? `, ${g.language} speaker` : ""}`;
  const pinnedNames = doc.pinned.map((t) => t.name);
  const avoid = [...companies.map((c) => c.name), ...pinnedNames, ...(doc.dismissed || [])];

  const wants = [
    f.industry && `Only companies in this industry: ${f.industry}.`,
    f.city && `Only companies with a large office in ${f.city}.`,
    f.size && `Only companies of this size: ${f.size}.`,
    f.category && `Only this kind of company: ${f.category}.`,
    f.language && `Prefer companies whose Indian teams include many ${f.language}-speaking engineers (e.g. big offices in that language's region).`,
    f.notes && `Host's extra request: ${f.notes}`,
  ].filter(Boolean).join("\n");

  const prompt = `You help ${settings.senderName} (${settings.senderRole}) find guests for the ${settings.podcastName}, where ${settings.podcastAbout}.

What makes a great guest: ${settings.guestCriteria}

Guests who ACCEPTED or RECORDED:
${yes.slice(0, 15).map(line).join("\n") || "- none yet"}

Guests who REJECTED or never replied:
${no.slice(0, 8).map(line).join("\n") || "- none yet"}

Traits common among guests who said yes:
${profile.traits.map((t) => `- ${t.trait}: ${t.value} (${t.yes} of ${t.total} said yes)`).join("\n") || "- not enough outcomes yet"}

Do NOT suggest these companies (already explored, pinned or rejected by the host):
${avoid.map((n) => `- ${n}`).join("\n") || "- none"}
${wants ? `\nFilters:\n${wants}\n` : ""}
Suggest 10 companies with offices in India where the host is most likely to find more guests like the ones who said yes. Give each an honest fitScore; spread the scores rather than giving every company 90. Prefer real, well-known companies and give their correct website domain.`;

  try {
    const out = await runAI({ kind: "recommend", parts: [{ text: prompt }], schema: SCHEMA, temperature: 0.7 });
    const dismissed = new Set(doc.dismissed || []);
    const items = cleanSuggestions(out.data.companies, guests, doc.pinned).filter((c) => !dismissed.has(c.key));
    doc.suggestions = { summary: out.data.summary || "", items, filters: f, generatedAt: new Date().toISOString(), provider: out.provider.name, model: out.model, basedOn: guests.length, outcomesUsed: yes.length + no.length };
    await writeDoc("targets", doc);
    return Response.json({ ...(await view()), notice: out.notice });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
