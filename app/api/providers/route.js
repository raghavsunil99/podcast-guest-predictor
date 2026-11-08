import { ADAPTERS, addProvider, getProviders, publicView } from "@/lib/ai/registry";
import { getStatus } from "@/lib/ai/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// List providers (keys masked) + available provider types.
export async function GET() {
  const [providers, status] = await Promise.all([getProviders(), getStatus()]);
  return Response.json({
    providers: providers.map((p) => ({ ...publicView(p), status: status[p.id] || null })),
    types: Object.values(ADAPTERS).map((a) => ({
      type: a.type, label: a.label, defaultModel: a.defaultModel, suggestedModels: a.suggestedModels,
      capabilities: a.capabilities, keyUrl: a.keyUrl, needsBaseUrl: a.type === "compatible", defaultBaseUrl: a.defaultBaseUrl || "", needsKey: a.needsKey !== false,
    })),
  });
}

// Add a provider. Body: { type, name, apiKey, model, baseUrl, dailyLimit }
export async function POST(req) {
  try {
    const p = await addProvider(await req.json());
    return Response.json({ provider: publicView(p) });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 400 });
  }
}
