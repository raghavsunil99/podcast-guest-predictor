"use client";

import { useState } from "react";
import Icon from "./icons";

// Where a published episode can live. The old single `link` field is read as YouTube.
export const EP_LINKS = [
  ["youtube", "YouTube", "youtube.com/watch?v=…"],
  ["spotify", "Spotify", "open.spotify.com/episode/…"],
  ["applePodcasts", "Apple Podcasts", "podcasts.apple.com/…"],
  ["instagram", "Instagram", "instagram.com/reel/…"],
  ["linkedin", "LinkedIn", "linkedin.com/posts/…"],
  ["other", "Other", "any other link"],
];

export const fullUrl = (u) => (/^https?:/i.test(u) ? u : `https://${u}`);

export function episodeLinks(ep = {}) {
  const links = { ...(ep.links || {}) };
  if (ep.link && !links.youtube) links.youtube = ep.link;
  return EP_LINKS.filter(([k]) => links[k]).map(([k, label]) => ({ key: k, label, url: fullUrl(links[k]) }));
}

function initial(ep = {}) {
  const links = { ...(ep.links || {}) };
  if (ep.link && !links.youtube) links.youtube = ep.link;
  return {
    number: ep.number ?? "",
    title: ep.title || "",
    recordedAt: ep.recordedAt || "",
    published: !!ep.published,
    publishedAt: ep.publishedAt || "",
    links,
  };
}

export function toEpisodePatch(e) {
  const links = Object.fromEntries(Object.entries(e.links).map(([k, v]) => [k, String(v || "").trim()]).filter(([, v]) => v));
  return {
    number: e.number === "" ? null : Math.max(1, Number(e.number)),
    title: e.title.trim(),
    recordedAt: e.recordedAt,
    published: e.published,
    publishedAt: e.published ? e.publishedAt : "",
    links,
    link: links.youtube || Object.values(links)[0] || "", // kept for CSV export and older views
  };
}

export default function EpisodeForm({ episode, onSave, onCancel, saveLabel = "Save episode" }) {
  const [e, setE] = useState(() => initial(episode));
  const [busy, setBusy] = useState(false);
  const set = (k) => (x) => setE({ ...e, [k]: x.target.type === "checkbox" ? x.target.checked : x.target.value });
  return (
    <div className="stack16">
      <div className="formGrid">
        <label className="field"><span>Episode number <em>sets the order</em></span><input type="number" min="1" value={e.number} onChange={set("number")} placeholder="e.g. 3" /></label>
        <label className="field"><span>Recorded on</span><input type="date" value={e.recordedAt} onChange={set("recordedAt")} /></label>
        <label className="field span2"><span>Episode title</span><input value={e.title} onChange={set("title")} placeholder="From TCS to Cisco: switching to software engineering" /></label>
      </div>
      <label className="pubToggle">
        <span className="switch small"><input type="checkbox" checked={e.published} onChange={set("published")} /><span className="switchTrack" aria-hidden /></span>
        <span><strong>Published</strong><span className="muted small block">Turn on once the episode is live, then add its links</span></span>
      </label>
      {e.published && (
        <div className="formGrid">
          <label className="field"><span>Published on</span><input type="date" value={e.publishedAt} onChange={set("publishedAt")} /></label>
          <span />
          {EP_LINKS.map(([k, label, ph]) => (
            <label key={k} className="field"><span>{label}</span>
              <input value={e.links[k] || ""} onChange={(x) => setE({ ...e, links: { ...e.links, [k]: x.target.value } })} placeholder={ph} />
            </label>
          ))}
        </div>
      )}
      <div className="row gap8">
        <button className="btn btnPrimary" disabled={busy} onClick={async () => { setBusy(true); try { await onSave(toEpisodePatch(e)); } finally { setBusy(false); } }}>
          <Icon name="check" size={16} />{saveLabel}
        </button>
        {onCancel && <button className="btn" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}
