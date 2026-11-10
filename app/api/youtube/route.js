// YouTube stats for published episodes. The API key is stored encrypted (like AI provider keys)
// or read from YOUTUBE_API_KEY, and is never sent to the browser.
import { readDoc, writeDoc } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/ai/secrets";
import { listGuests } from "@/lib/guestStore";
import { runAI } from "@/lib/ai/service";
import { addSnapshot, episodeVideoId, fetchComments, fetchVideos } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const hint = (k) => `…${String(k).slice(-4)}`;

async function getKey() {
  if (process.env.YOUTUBE_API_KEY) return { key: process.env.YOUTUBE_API_KEY, source: "env", hint: hint(process.env.YOUTUBE_API_KEY) };
  const cfg = await readDoc("youtube-key", null);
  if (!cfg?.keyEnc) return null;
  try { return { key: await decrypt(cfg.keyEnc), source: "saved", hint: cfg.keyHint }; } catch { return null; }
}

async function view() {
  const [k, stats, guests] = await Promise.all([getKey(), readDoc("youtube-stats", { videos: {} }), listGuests()]);
  const linked = guests.filter((g) => episodeVideoId(g.episode)).length;
  return { hasKey: !!k, keySource: k?.source || "", keyHint: k?.hint || "", linked, videos: stats.videos || {}, fetchedAt: stats.fetchedAt || null, error: stats.error || "" };
}

export async function GET() {
  return Response.json(await view());
}

// { action: "key", key } | { action: "removeKey" } | { action: "refresh" } | { action: "comments", id, summarize }
export async function POST(req) {
  const body = await req.json().catch(() => ({}));

  if (body.action === "key") {
    const key = String(body.key || "").trim();
    if (!key) return Response.json({ error: "Paste the API key." }, { status: 400 });
    try {
      await fetchVideos(["dQw4w9WgXcQ"], key); // any public video: proves the key works
    } catch (err) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    await writeDoc("youtube-key", { keyEnc: await encrypt(key), keyHint: hint(key), savedAt: new Date().toISOString() }, { secret: true });
    return Response.json(await view());
  }

  if (body.action === "removeKey") {
    await writeDoc("youtube-key", {}, { secret: true });
    return Response.json(await view());
  }

  const k = await getKey();
  if (!k) return Response.json({ error: "Add a YouTube API key in Settings → YouTube first." }, { status: 400 });

  if (body.action === "refresh") {
    const guests = await listGuests();
    const ids = [...new Set(guests.map((g) => episodeVideoId(g.episode)).filter(Boolean))];
    const stats = await readDoc("youtube-stats", { videos: {} });
    if (!ids.length) return Response.json(await view());
    try {
      const fresh = await fetchVideos(ids, k.key);
      const videos = { ...(stats.videos || {}) };
      for (const id of ids) {
        if (fresh[id]) videos[id] = addSnapshot(videos[id], fresh[id]);
        else videos[id] = { ...(videos[id] || {}), missing: true }; // private, deleted or wrong link
      }
      await writeDoc("youtube-stats", { videos, fetchedAt: new Date().toISOString(), error: "" });
    } catch (err) {
      await writeDoc("youtube-stats", { ...stats, error: err.message });
      return Response.json({ ...(await view()), error: err.message }, { status: 502 });
    }
    return Response.json(await view());
  }

  if (body.action === "comments" && body.id) {
    try {
      const comments = await fetchComments(body.id, k.key, 40);
      let insight = null;
      if (body.summarize && comments.length) {
        const out = await runAI({
          kind: "recommend",
          parts: [{ text: `These are YouTube comments on a career podcast episode for students. Summarise what viewers say.\n\n${comments.map((c) => `- (${c.likes} likes) ${c.text}`).join("\n")}` }],
          schema: {
            type: "object",
            properties: {
              summary: { type: "string", description: "Two sentences on the overall reaction" },
              sentiment: { type: "string", enum: ["Very positive", "Positive", "Mixed", "Negative"] },
              liked: { type: "array", items: { type: "string" }, description: "Up to 4 things viewers liked" },
              questions: { type: "array", items: { type: "string" }, description: "Up to 4 questions or follow-up topics viewers asked for" },
            },
            required: ["summary", "sentiment", "liked", "questions"],
          },
          temperature: 0.3,
        });
        insight = { ...out.data, at: new Date().toISOString(), basedOn: comments.length };
        const stats = await readDoc("youtube-stats", { videos: {} });
        if (stats.videos?.[body.id]) { stats.videos[body.id].insight = insight; await writeDoc("youtube-stats", stats); }
      }
      return Response.json({ comments, insight });
    } catch (err) {
      return Response.json({ error: err.message }, { status: err.status === 403 ? 403 : 502 });
    }
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
