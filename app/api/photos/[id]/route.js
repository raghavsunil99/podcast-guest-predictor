import { readPhoto } from "@/lib/photos";

export const runtime = "nodejs";

export async function GET(_req, { params }) {
  const { id } = await params;
  const p = await readPhoto(id);
  if (!p) return new Response(null, { status: 404 });
  return new Response(p.body, { headers: { "Content-Type": p.type, "Cache-Control": "private, max-age=31536000, immutable" } });
}
