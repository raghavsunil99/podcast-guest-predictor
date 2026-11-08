import { enrichCompanies, importLegacy, listGuests, upsertFromResult } from "@/lib/guestStore";
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
  return Response.json({ error: "Unknown action." }, { status: 400 });
}
