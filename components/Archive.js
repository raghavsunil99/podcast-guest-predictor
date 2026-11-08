"use client";

import { useState } from "react";
import Icon from "./icons";
import { Avatar, CompanyName, Drawer, Empty, fmtDate } from "./ui";
import { exportCSV } from "./Guests";
import EpisodeForm, { episodeLinks } from "./EpisodeForm";

// Episode order: the number you set wins; otherwise episodes are numbered by recording date.
export function orderEpisodes(guests) {
  const byDate = guests
    .filter((g) => g.stage === "Recorded")
    .sort((a, b) => String(a.episode?.recordedAt || "").localeCompare(String(b.episode?.recordedAt || "")) || String(a.updatedAt || "").localeCompare(String(b.updatedAt || "")));
  return byDate
    .map((g, i) => ({ g, key: g.episode?.number ?? i + 1, i }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map((x, i) => ({ g: x.g, no: i + 1 }));
}

export default function Archive({ guests, api }) {
  const [editing, setEditing] = useState(null);
  const [moving, setMoving] = useState(false);
  const ordered = orderEpisodes(guests); // oldest → newest
  const shown = [...ordered].reverse();

  async function move(idx, dir) {
    const j = idx + dir; // in oldest→newest order
    if (j < 0 || j >= ordered.length || moving) return;
    const list = ordered.map((x) => x.g);
    [list[idx], list[j]] = [list[j], list[idx]];
    setMoving(true);
    try {
      for (let k = 0; k < list.length; k++) {
        if (list[k].episode?.number !== k + 1) await api.patch(list[k].id, { episode: { number: k + 1 } });
      }
    } finally {
      setMoving(false);
    }
  }

  if (!ordered.length) {
    return (
      <Empty icon="archive" title="No recorded episodes yet" action={<button className="btn" onClick={() => api.go("pipeline")}>Open pipeline</button>}>
        When you move a guest to Recorded, their episode appears here with guest and company details.
      </Empty>
    );
  }

  const published = ordered.filter((x) => x.g.episode?.published).length;

  return (
    <div className="stack12">
      <div className="row gap8">
        <p className="muted small grow">{ordered.length} episode{ordered.length > 1 ? "s" : ""} recorded · {published} published</p>
        <button className="btn btnSm" onClick={() => exportCSV(ordered.map((x) => x.g), "recorded-episodes")}><Icon name="download" size={14} />Export</button>
      </div>
      <div className="archiveGrid">
        {shown.map(({ g, no }, i) => {
          const idx = no - 1;
          const ep = g.episode || {};
          const links = episodeLinks(ep);
          return (
            <article key={g.id} className="episode" onClick={() => api.open(g.id)}>
              <div className="epCover" style={{ "--seed": (i * 47) % 360 }}>
                <span className="epNo">EP {String(no).padStart(2, "0")}</span>
                <span className={`epPub${ep.published ? " on" : ""}`}>{ep.published ? "Published" : "Not published"}</span>
                <div className="epTools" onClick={(e) => e.stopPropagation()}>
                  <button title="Move left (higher episode number)" disabled={idx === ordered.length - 1 || moving} onClick={() => move(idx, 1)}><span className="flipX"><Icon name="chevronRight" size={14} /></span></button>
                  <button title="Move right (lower episode number)" disabled={idx === 0 || moving} onClick={() => move(idx, -1)}><Icon name="chevronRight" size={14} /></button>
                  <button title="Edit episode" onClick={() => setEditing(g)}><Icon name="edit" size={13} /></button>
                </div>
                <Avatar name={g.name} src={g.photoUrl} alt={g.gravatarUrl} size={72} ring />
              </div>
              <div className="epBody">
                <span className="muted tiny">
                  Recorded {ep.recordedAt ? fmtDate(ep.recordedAt) : "date not set"}
                  {ep.published && ep.publishedAt ? ` · Published ${fmtDate(ep.publishedAt)}` : ""}
                </span>
                <h3>{ep.title || `Episode with ${g.name}`}</h3>
                {!ep.title && g.result?.hook && <p className="muted small">{g.result.hook.charAt(0).toUpperCase() + g.result.hook.slice(1)}</p>}
                <p className="epGuest"><strong>{g.name}</strong> · {g.role}</p>
                <CompanyName name={g.company} domain={g.companyDomain} />
                <div className="row gap8 epActions wrap" onClick={(e) => e.stopPropagation()}>
                  {links.length ? (
                    links.map((l) => (
                      <a key={l.key} className="btn btnSm" href={l.url} target="_blank" rel="noreferrer">
                        <Icon name={l.key === "youtube" ? "play" : "external"} size={13} />{l.label}
                      </a>
                    ))
                  ) : (
                    <button className="linkBtn tiny" onClick={() => setEditing(g)}>
                      <Icon name="edit" size={12} />{ep.published ? "Add the published links" : "Edit date, order or publish status"}
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {editing && (
        <Drawer onClose={() => setEditing(null)} label="Edit episode">
          <div className="drawerBody stack16" style={{ padding: 24 }}>
            <div>
              <h2>Edit episode</h2>
              <p className="muted small">{editing.name} · {editing.role}{editing.company ? ` at ${editing.company}` : ""}</p>
            </div>
            <EpisodeForm
              episode={editing.episode}
              onCancel={() => setEditing(null)}
              onSave={async (episode) => {
                const target = episode.number;
                // Changing the number shifts the others so numbers stay 1, 2, 3… without gaps.
                if (target && target !== orderEpisodes(guests).find((x) => x.g.id === editing.id)?.no) {
                  const rest = orderEpisodes(guests).map((x) => x.g).filter((x) => x.id !== editing.id);
                  rest.splice(Math.min(target, rest.length + 1) - 1, 0, editing);
                  for (let k = 0; k < rest.length; k++) {
                    if (rest[k].id === editing.id) continue;
                    if (rest[k].episode?.number !== k + 1) await api.patch(rest[k].id, { episode: { number: k + 1 } });
                  }
                  episode.number = rest.findIndex((x) => x.id === editing.id) + 1;
                }
                await api.patch(editing.id, { episode });
                setEditing(null);
              }}
            />
          </div>
        </Drawer>
      )}
    </div>
  );
}
