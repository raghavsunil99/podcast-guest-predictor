// Website domains for companies that only appear in guests' career history (previous employers),
// so their logos can be shown. Known domains from current employers are reused; the rest are looked
// up once with a single small AI request and remembered in the "company-domains" document.
import { readDoc, writeDoc } from "@/lib/db";
import { listGuests } from "@/lib/guestStore";
import { companyKey, normDomain, previousCompanies } from "@/lib/crm";
import { validDomain } from "@/lib/crm";
import { runAI } from "@/lib/ai/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function build() {
  const [saved, guests] = await Promise.all([readDoc("company-domains", {}), listGuests()]);
  const map = { ...saved };
  for (const g of guests) {
    const k = companyKey(g);
    if (k && validDomain(g.companyDomain)) map[k] = normDomain(g.companyDomain);
  }
  return { map, saved, guests };
}

export async function GET() {
  const { map } = await build();
  return Response.json({ domains: map });
}

// { action: "fill" } → look up domains for previous employers not known yet
export async function POST() {
  const { map, saved, guests } = await build();
  const missing = [...new Map(
    guests.flatMap((g) => previousCompanies(g, 6)).map((n) => [companyKey({ company: n }), n])
  ).entries()].filter(([k]) => k && !(k in map)).map(([, n]) => n).slice(0, 60);
  if (!missing.length) return Response.json({ domains: map, added: 0 });
  try {
    const out = await runAI({
      kind: "enrich",
      parts: [{ text: `Give the official website domain for each organisation (e.g. "google.com", "iisc.ac.in"). Use "" if unsure.\n${missing.map((c) => `- ${c}`).join("\n")}` }],
      schema: {
        type: "object",
        properties: { companies: { type: "array", items: { type: "object", properties: { company: { type: "string" }, domain: { type: "string" } }, required: ["company", "domain"] } } },
        required: ["companies"],
      },
      temperature: 0,
    });
    const next = { ...saved };
    const byName = new Map((out.data.companies || []).map((c) => [companyKey({ company: c.company }), c.domain]));
    // Remember every name we asked about (even unknown ones, as "") so we don't ask again.
    for (const n of missing) {
      const k = companyKey({ company: n });
      const d = byName.get(k);
      next[k] = validDomain(d) ? normDomain(d) : "";
    }
    await writeDoc("company-domains", next);
    return Response.json({ domains: { ...map, ...next }, added: missing.length });
  } catch (err) {
    return Response.json({ domains: map, added: 0, error: String(err.message || err) });
  }
}
