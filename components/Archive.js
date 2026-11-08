"use client";

import { useState } from "react";
import Icon from "./icons";
import GuestPhoto from "./GuestPhoto";
import { CompanyName, Drawer, Empty, ViewSwitch, fmtDate, useViewPref } from "./ui";
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
  const [view, setView] = useViewPref("episodes", "cards");
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
        <ViewSwitch value={view} onChange={setView} options={["cards", "grid", "list"]} />
        <button className="btn btnSm" onClick={() => exportCSV(ordered.map((x) => x.g), "recorded-episodes")}><Icon name="download" size={14} />Export</button>
      </div>
      {view === "list" && (
        <div className="epList card flush">
          {shown.map(({ g, no }) => {
            const ep = g.episode || {};
            const links = episodeLinks(ep);
            return (
              <div key={g.id} className="epRow" onClick={() => api.open(g.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && api.open(g.id)}>
                <span className="epRowNo">EP {String(no).padStart(2, "0")}</span>
                <GuestPhoto g={g} size={40} />
                <div className="epRowMain">
                  <strong className="ellipsis">{ep.title || `Episode with ${g.name}`}</strong>
                  <span className="muted small ellipsis">{g.name} · {g.role}</span>
                </div>
                <span className="epRowCo hideSm"><CompanyName name={g.company} domain={g.companyDomain} /></span>
                <span className="muted small hideSm epRowDate">{ep.recordedAt ? fmtDate(ep.recordedAt) : "No date"}</span>
                <span className={`pubPill${ep.published ? " on" : ""}`}>{ep.published ? "Published" : "Not published"}</span>
                <span className="epRowLinks" onClick={(e) => e.stopPropagation()}>
                  {links.map((l) => <a key={l.key} className="iconBtn sm" href={l.url} target="_blank" rel="noreferrer" title={l.label}><Icon name={l.key === "youtube" ? "play" : "external"} size={13} /></a>)}
                  <button className="iconBtn sm" title="Move up (higher number)" disabled={no === ordered.length || moving} onClick={() => move(no - 1, 1)}><Icon name="arrowUp" size={13} /></button>
                  <button className="iconBtn sm" title="Move down (lower number)" disabled={no === 1 || moving} onClick={() => move(no - 1, -1)}><Icon name="arrowDown" size={13} /></button>
                  <button className="iconBtn sm" title="Edit episode" onClick={() => setEditing(g)}><Icon name="edit" size={13} /></button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {view === "grid" && (
        <div className="epTiles">
          {shown.map(({ g, no }) => {
            const ep = g.episode || {};
            return (
              <div key={g.id} className="epTile" onClick={() => api.open(g.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && api.open(g.id)}>
                <span className="epTileNo">EP {String(no).padStart(2, "0")}</span>
                <button className="iconBtn sm epTileEdit" title="Edit episode" onClick={(e) => { e.stopPropagation(); setEditing(g); }}><Icon name="edit" size={12} /></button>
                <GuestPhoto g={g} size={64} ring />
                <strong className="clamp2 epTileName">{g.name}</strong>
                <span className="epTileCo"><CompanyName name={g.company} domain={g.companyDomain} size={16} /></span>
                <span className={`pubPill${ep.published ? " on" : ""}`}>{ep.published ? "Published" : ep.recordedAt ? fmtDate(ep.recordedAt) : "Recorded"}</span>
              </div>
            );
          })}
        </div>
      )}

      {view === "cards" && (
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
                <GuestPhoto g={g} size={72} ring />
              </div>
              <div className="epBody">
                <span className="muted tiny">
                  Recorded {ep.recordedAt ? fmtDate(ep.recordedAt) : "date not set"}
                  {ep.published && ep.publishedAt ? ` · Published ${fmtDate(ep.publishedAt)}` : ""}
                </span>
                <h3 className="epTitle">{ep.title || `Episode with ${g.name}`}</h3>
                <p className="muted small epHook">{!ep.title && g.result?.hook ? g.result.hook.charAt(0).toUpperCase() + g.result.hook.slice(1) : ""}</p>
                <p className="epGuest" title={`${g.name} · ${g.role}`}><strong>{g.name}</strong> · {g.role}</p>
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
      )}

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
