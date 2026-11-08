// Podcast settings and templates, stored with the rest of the data (database or data/ folder)
// so they follow you to another computer.
import { readDoc, writeDoc } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ settings: await readDoc("settings", null) });
}

export async function PUT(req) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.settings !== "object") return Response.json({ error: "Bad settings." }, { status: 400 });
  await writeDoc("settings", body.settings);
  return Response.json({ ok: true });
}
