// Where data is stored right now, for Settings → Data.
import { db, usingDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!usingDatabase()) return Response.json({ mode: "files", where: "data/ folder on this computer" });
  try {
    const host = new URL(process.env.DATABASE_URL).hostname;
    const c = await db();
    const g = await c.query("select count(*)::int n from guests");
    const p = await c.query("select count(*)::int n from photos");
    const u = await c.query("select count(*)::int n from usage_events");
    return Response.json({ mode: "database", where: host, guests: g.rows[0].n, photos: p.rows[0].n, usageEvents: u.rows[0].n, ok: true });
  } catch (err) {
    return Response.json({ mode: "database", ok: false, error: String(err.message).slice(0, 200) }, { status: 500 });
  }
}
