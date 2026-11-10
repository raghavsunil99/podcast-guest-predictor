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

export const CHECKLIST = {
  before: [["research", "Research done"], ["questions", "Questions shared with guest"], ["bio", "Guest bio and photo received"], ["reminder", "Reminder sent a day before"]],
  after: [["thanks", "Thank-you sent"], ["tagged", "Guest tagged in the post"]],
};

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
    scheduledAt: ep.scheduledAt || "",
    mode: ep.mode || "Online",
    meetingLink: ep.meetingLink || "",
    editor: ep.editor || "",
    targetPublish: ep.targetPublish || "",
    checklist: { ...(ep.checklist || {}) },
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
    scheduledAt: e.scheduledAt,
    mode: e.mode,
    meetingLink: e.meetingLink.trim(),
    editor: e.editor.trim(),
    targetPublish: e.targetPublish,
    checklist: e.checklist,
  };
}

export default function EpisodeForm({ episode, onSave, onCancel, saveLabel = "Save episode" }) {
  const [e, setE] = useState(() => initial(episode));
  const [busy, setBusy] = useState(false);
  const set = (k) => (x) => setE({ ...e, [k]: x.target.type === "checkbox" ? x.target.checked : x.target.value });
  return (
    <div className="stack16">
      <div className="formGrid">
        <label className="field"><span>Recording date &amp; time</span><input type="datetime-local" value={e.scheduledAt} onChange={set("scheduledAt")} /></label>
        <label className="field"><span>Where</span>
          <select value={e.mode} onChange={set("mode")}><option>Online</option><option>Studio</option><option>Phone</option></select>
        </label>
        <label className="field span2"><span>Meeting link <em>optional</em></span><input value={e.meetingLink} onChange={set("meetingLink")} placeholder="meet.google.com/… or zoom link" /></label>
        <label className="field"><span>Editor <em>optional</em></span><input value={e.editor} onChange={set("editor")} placeholder="Who is editing it" /></label>
        <label className="field"><span>Target publish date</span><input type="date" value={e.targetPublish} onChange={set("targetPublish")} /></label>
        <label className="field"><span>Episode number <em>sets the order</em></span><input type="number" min="1" value={e.number} onChange={set("number")} placeholder="e.g. 3" /></label>
        <label className="field"><span>Recorded on</span><input type="date" value={e.recordedAt} onChange={set("recordedAt")} /></label>
        <label className="field span2"><span>Episode title</span><input value={e.title} onChange={set("title")} placeholder="From TCS to Cisco: switching to software engineering" /></label>
      </div>
      <div className="checklist">
        {Object.entries(CHECKLIST).map(([part, items]) => (
          <div key={part}>
            <span className="eyebrow">{part === "before" ? "Before recording" : "After publishing"}</span>
            {items.map(([k, label]) => (
              <label key={k} className="checkItem">
                <input type="checkbox" checked={!!e.checklist[k]} onChange={(x) => setE({ ...e, checklist: { ...e.checklist, [k]: x.target.checked } })} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        ))}
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

const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }) : "");

/** Ready-to-copy messages for each step after a yes. Filled from the episode details, no AI needed. */
export function episodeMessages(g, settings = {}) {
  const ep = g.episode || {};
  const first = g.result?.profile?.firstName || String(g.name || "").split(" ")[0];
  const hon = g.result?.honorific ? ` ${g.result.honorific}` : "";
  const hi = `Hi ${first}${hon},`;
  const me = settings.senderName || "Raghavendra";
  const show = settings.podcastName || "the podcast";
  const where = ep.mode === "Studio" ? "at our studio" : ep.mode === "Phone" ? "over a call" : ep.meetingLink ? `online: ${fullUrl(ep.meetingLink)}` : "online (I'll share the link)";
  const yt = episodeLinks(ep).find((l) => l.key === "youtube") || episodeLinks(ep)[0];
  const out = [];
  if (ep.scheduledAt) {
    out.push({ key: "confirm", label: "Confirm the recording", text: `${hi}\n\nThank you for agreeing to join the ${show}! Confirming our conversation on ${fmtWhen(ep.scheduledAt)}, ${where}.\n\nIt will be a relaxed 30–45 minute chat about your journey. I'll share a few discussion points beforehand. Please let me know if the time needs to change.\n\nLooking forward to it!\n${me}` });
    out.push({ key: "remind", label: "Reminder (day before)", text: `${hi}\n\nA quick reminder about our ${show} conversation tomorrow, ${fmtWhen(ep.scheduledAt)}, ${where}.\n\nSee you then!\n${me}` });
  }
  if (g.milestones?.Recorded) {
    out.push({ key: "thanks", label: "Thank you after recording", text: `${hi}\n\nThank you so much for the wonderful conversation on the ${show}. Your journey will inspire a lot of students. I'll share the episode link as soon as it's live.\n\n${me}` });
  }
  if (yt) {
    out.push({ key: "live", label: "Episode is live", text: `${hi}\n\nYour ${show} episode is live! 🎉\n${yt.url}\n\nIt would mean a lot if you could share it with your network. Thank you again!\n${me}` });
  }
  return out;
}
