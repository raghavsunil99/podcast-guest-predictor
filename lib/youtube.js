// YouTube performance for published episodes: public stats from the YouTube Data API (views,
// likes, comments), one snapshot per day so growth can be shown, and simple comparisons.
// Needs a free YouTube Data API key (no sign-in). Plain module; network calls take the key as input.

// youtu.be/ID, youtube.com/watch?v=ID, /shorts/ID, /live/ID, /embed/ID → ID
export function videoIdFrom(url) {
  const u = String(url || "").trim();
  const m =
    u.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ||
    u.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
    u.match(/youtube\.com\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : "";
}

// The YouTube link saved on an episode (links.youtube, or the older single link).
export function episodeVideoId(ep = {}) {
  return videoIdFrom(ep.links?.youtube) || videoIdFrom(ep.link) || "";
}

// "PT1H2M3S" → 3723 seconds
export function isoSeconds(d) {
  const m = String(d || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

const API = "https://www.googleapis.com/youtube/v3";

async function get(path, params, key) {
  const qs = new URLSearchParams({ ...params, key });
  const r = await fetch(`${API}/${path}?${qs}`, { signal: AbortSignal.timeout(20_000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const reason = data.error?.errors?.[0]?.reason || "";
    const msg =
      reason === "keyInvalid" || /API key not valid/i.test(data.error?.message || "") ? "The YouTube API key isn't valid. Check it in Settings → YouTube."
        : reason === "accessNotConfigured" || /has not been used|is disabled/i.test(data.error?.message || "") ? "YouTube Data API v3 isn't enabled for this key's Google Cloud project. Enable it, then try again."
          : reason === "quotaExceeded" ? "Today's YouTube API quota is used up. It resets at midnight Pacific time."
            : reason === "commentsDisabled" ? "Comments are turned off for this video."
              : data.error?.message || `YouTube error ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.reason = reason;
    throw err;
  }
  return data;
}

/** Stats for up to 50 videos per call. Returns { [id]: {...} } (missing/private videos are left out). */
export async function fetchVideos(ids, key) {
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const data = await get("videos", { part: "snippet,statistics,contentDetails", id: ids.slice(i, i + 50).join(","), maxResults: "50" }, key);
    for (const v of data.items || []) {
      const s = v.statistics || {};
      out[v.id] = {
        title: v.snippet?.title || "",
        channel: v.snippet?.channelTitle || "",
        publishedAt: v.snippet?.publishedAt || "",
        thumb: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url || "",
        seconds: isoSeconds(v.contentDetails?.duration),
        views: Number(s.viewCount || 0),
        likes: s.likeCount != null ? Number(s.likeCount) : null, // hidden by the channel when null
        comments: s.commentCount != null ? Number(s.commentCount) : null,
      };
    }
  }
  return out;
}

/** Latest top-level comments (text only). */
export async function fetchComments(id, key, max = 30) {
  const data = await get("commentThreads", { part: "snippet", videoId: id, maxResults: String(max), order: "relevance", textFormat: "plainText" }, key);
  return (data.items || []).map((t) => {
    const c = t.snippet?.topLevelComment?.snippet || {};
    return { author: c.authorDisplayName || "", text: String(c.textDisplay || "").slice(0, 500), likes: c.likeCount || 0, at: c.publishedAt || "" };
  });
}

/** Add today's numbers to a video's history (one snapshot per day, latest wins). */
export function addSnapshot(prev = {}, stats, day = new Date().toISOString().slice(0, 10)) {
  const snaps = (prev.snapshots || []).filter((x) => x.d !== day);
  snaps.push({ d: day, views: stats.views, likes: stats.likes, comments: stats.comments });
  snaps.sort((a, b) => a.d.localeCompare(b.d));
  return { ...prev, ...stats, snapshots: snaps.slice(-400) };
}

/** Growth over the last `days` days, from the nearest snapshot at or before that date. */
export function growth(v, days = 7, today = new Date().toISOString().slice(0, 10)) {
  const snaps = v?.snapshots || [];
  if (snaps.length < 2) return null;
  const cutoff = new Date(Date.parse(today) - days * 86400000).toISOString().slice(0, 10);
  const base = [...snaps].reverse().find((s) => s.d <= cutoff) || snaps[0];
  const last = snaps[snaps.length - 1];
  if (base.d === last.d) return null;
  return { views: last.views - base.views, since: base.d };
}

/** Views in the first N days after publishing (fairer to compare new and old episodes). */
export function earlyViews(v, days = 7) {
  if (!v?.publishedAt || !v.snapshots?.length) return null;
  const end = new Date(Date.parse(v.publishedAt) + days * 86400000).toISOString().slice(0, 10);
  const within = v.snapshots.filter((s) => s.d <= end);
  return within.length ? within[within.length - 1].views : null;
}

/** Which guest traits go with more views (average views per episode, at least 2 episodes per group). */
export function viewsByTrait(rows) {
  const groups = {};
  const addTo = (label, value, views) => {
    if (!value) return;
    const k = `${label}: ${value}`;
    (groups[k] ||= { label, value, views: [], names: [] }).views.push(views);
  };
  for (const { g, v } of rows) {
    if (!v) continue;
    for (const t of g.careerTags || []) if (!t.startsWith("Promoted")) addTo("Story", t, v.views);
    addTo("Company type", g.industry, v.views);
    addTo("Language", g.language, v.views);
  }
  const all = rows.filter((r) => r.v).map((r) => r.v.views);
  const avg = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
  return Object.values(groups)
    .filter((x) => x.views.length >= 2 && avg > 0)
    .map((x) => ({ ...x, avg: Math.round(x.views.reduce((a, b) => a + b, 0) / x.views.length), times: x.views.reduce((a, b) => a + b, 0) / x.views.length / avg }))
    .sort((a, b) => b.times - a.times);
}
