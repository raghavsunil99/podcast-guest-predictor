import { convertCareers, enrichCompanies, importLegacy, listGuests, upsertFromResult } from "@/lib/guestStore";
import { CAREER_SWITCH_SCHEMA, EDUCATION_SCHEMA, EXPERIENCE_SCHEMA } from "@/lib/career";
import { decorate } from "@/lib/photos";
import { runAI } from "@/lib/ai/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ guests: (await listGuests()).map(decorate) });
}

// { action: "save", result, url }  → save a generated profile (duplicates are merged)
// { action: "import", entries }    → one-time import of v1 browser history
// { action: "enrich" }             → look up company websites/industries for older guests
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  if (body.action === "save" && body.result) {
    const out = await upsertFromResult(body.result, body.url || "");
    return Response.json({ ...out, guest: decorate(out.guest) });
  }
  if (body.action === "import" && Array.isArray(body.entries)) {
    return Response.json(await importLegacy(body.entries));
  }
  if (body.action === "enrich") {
    try {
      const out = await enrichCompanies(async (companies) => {
        const res = await runAI({
          kind: "enrich",
          parts: [{ text: `For each company, give its official website domain (e.g. "cisco.com") and a short industry label (e.g. "Networking", "IT Services", "Fintech"). Use "" for the domain if unsure.\n${companies.map((c) => `- ${c}`).join("\n")}` }],
          schema: {
            type: "object",
            properties: {
              companies: {
                type: "array",
                items: {
                  type: "object",
                  properties: { company: { type: "string" }, domain: { type: "string" }, industry: { type: "string" } },
                  required: ["company", "domain", "industry"],
                },
              },
            },
            required: ["companies"],
          },
        });
        return res.data.companies || [];
      });
      return Response.json(out);
    } catch (err) {
      console.warn("[enrich]", err.message);
      return Response.json({ updated: 0, error: "lookup failed" });
    }
  }
  if (body.action === "career") {
    const out = await convertCareers(async (batch) => {
      const text = batch
        .map((g) => {
          const p = g.result.profile;
          return `### GUEST ${g.id}\nName: ${p.fullName}\nCurrent: ${p.currentRole} at ${p.currentCompany}\nTotal experience: ${p.totalExperience}\nCareer path:\n${(p.careerPath || []).map((c) => `- ${c}`).join("\n") || "- (none)"}\nEducation:\n${(p.education || []).map((e) => `- ${e.institution} | ${e.degree} | ${e.place} | ${e.years}`).join("\n") || "- (none)"}\nAbout: ${p.aboutSummary || ""}`;
        })
        .join("\n\n");
      const res = await runAI({
        kind: "career",
        parts: [{ text: `Convert each guest's career path and education into the structured format. Use ONLY the facts given: keep dates exactly as written (years only if no month), group roles at the same company, and mark the current role's end as "Present". Do not invent jobs, dates or degrees.\n\n${text}` }],
        schema: {
          type: "object",
          properties: {
            guests: {
              type: "array",
              items: {
                type: "object",
                properties: { id: { type: "string" }, experience: EXPERIENCE_SCHEMA, education: EDUCATION_SCHEMA, careerSwitch: CAREER_SWITCH_SCHEMA },
                required: ["id", "experience", "education", "careerSwitch"],
              },
            },
          },
          required: ["guests"],
        },
      });
      return res.data.guests || [];
    });
    return Response.json(out);
  }
  return Response.json({ error: "Unknown action." }, { status: 400 });
}
