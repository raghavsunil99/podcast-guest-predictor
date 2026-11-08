// Company logo proxy: fetches the site's icon from Google's favicon service and returns 404
// when Google only has its generic placeholder, so the UI can show a monogram instead.
export const runtime = "nodejs";

const cache = new Map(); // domain → { body, type } | null

export async function GET(req) {
  const domain = String(new URL(req.url).searchParams.get("domain") || "")
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "")
    .slice(0, 100);
  if (!domain.includes(".")) return new Response(null, { status: 404 });

  if (!cache.has(domain)) {
    let hit = null;
    try {
      const r = await fetch(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`, { redirect: "follow" });
      if (r.ok) hit = { body: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") || "image/png" };
    } catch {}
    cache.set(domain, hit);
  }
  const hit = cache.get(domain);
  if (!hit) return new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=86400" } });
  return new Response(hit.body, { headers: { "Content-Type": hit.type, "Cache-Control": "public, max-age=604800" } });
}
