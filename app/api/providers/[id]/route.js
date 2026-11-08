import { ADAPTERS, getProviders, publicView, removeProvider, resolveKey, updateProvider } from "@/lib/ai/registry";
import { testProvider } from "@/lib/ai/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Edit: { name, model, fallbackModels, baseUrl, enabled, dailyLimit, warnAt, apiKey, move: "top"|"up"|"down" }
// Actions: { action: "test" } | { action: "models" }
export async function PATCH(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (body.action === "test" || body.action === "models") {
    const p = (await getProviders()).find((x) => x.id === id);
    if (!p) return Response.json({ error: "Provider not found." }, { status: 404 });
    if (body.action === "test") return Response.json(await testProvider(p));
    try {
      const models = await ADAPTERS[p.type].listModels({ apiKey: await resolveKey(p), baseUrl: p.baseUrl });
      return Response.json({ models });
    } catch (err) {
      const c = ADAPTERS[p.type].classify(err);
      return Response.json({ error: `Couldn't load models: ${c.message}`, type: c.type }, { status: 400 });
    }
  }
  const p = await updateProvider(id, body);
  if (!p) return Response.json({ error: "Provider not found." }, { status: 404 });
  return Response.json({ provider: publicView(p) });
}

export async function DELETE(_req, { params }) {
  const { id } = await params;
  return (await removeProvider(id)) ? Response.json({ ok: true }) : Response.json({ error: "Provider not found." }, { status: 404 });
}
