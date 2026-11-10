"use client";

import { useEffect, useMemo, useState } from "react";
import Icon from "./icons";
import PastCompanies from "./PastCompanies";
import GuestPhoto from "./GuestPhoto";
import { CompanyName, Drawer, Empty, Segmented, StageBadge, ViewSwitch, fmtDate, useViewPref } from "./ui";
import { exportCSV } from "./Guests";
import EpisodeForm, { episodeLinks } from "./EpisodeForm";
import { episodeTopic, isRecorded } from "@/lib/crm";
import { earlyViews, episodeVideoId, growth, viewsByTrait } from "@/lib/youtube";

const fmtN = (n) => (n == null ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));
const fmtDur = (s) => (!s ? "" : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : `${Math.round(s / 60)} min`);

// YouTube stats for episodes, refreshed automatically when older than 6 hours.
function useYouTube() {
  const [yt, setYt] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/youtube", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh" }) });
      setYt(await r.json());
    } catch {} finally { setBusy(false); }
  };
  useEffect(() => {
    fetch("/api/youtube", { cache: "no-store" }).then((r) => r.json()).then((d) => {
      setYt(d);
      const stale = !d.fetchedAt || Date.now() - Date.parse(d.fetchedAt) > 6 * 3600 * 1000;
      if (d.hasKey && d.linked && stale) refresh();
    }).catch(() => setYt({}));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { yt, busy, refresh };
}

// Small "👁 1.2K · 👍 80 · 💬 12 · +340 this week" line for a card.
function StatLine({ v, compact }) {
  if (!v || v.missing) return v?.missing ? <span className="ytStats muted tiny">Video not found (private or wrong link)</span> : null;
  const gr = growth(v, 7);
  return (
    <span className={`ytStats${compact ? " compact" : ""}`} title={`${v.views.toLocaleString("en-IN")} views${v.likes != null ? ` · ${v.likes} likes` : ""}${v.comments != null ? ` · ${v.comments} comments` : ""}`}>
      <span><Icon name="eye" size={13} />{fmtN(v.views)}</span>
      {!compact && v.likes != null && <span><Icon name="thumbUp" size={13} />{fmtN(v.likes)}</span>}
      {!compact && v.comments != null && <span><Icon name="comment" size={13} />{fmtN(v.comments)}</span>}
      {!compact && gr && gr.views > 0 && <span className="ytUp">+{fmtN(gr.views)} this week</span>}
    </span>
  );
}

// Totals, ranking, and which kinds of guests get the most views.
function Performance({ ordered, yt, busy, refresh, api, onComments }) {
  const rows = ordered.map(({ g, no }) => ({ g, no, id: episodeVideoId(g.episode), v: yt?.videos?.[episodeVideoId(g.episode)] })).filter((r) => r.id);
  const live = rows.filter((r) => r.v && !r.v.missing);
  const [sort, setSort] = useState("views");
  const traits = useMemo(() => viewsByTrait(live), [live]);
  if (!rows.length) return null;
  if (!yt?.hasKey) {
    return (
      <div className="card ytSetup">
        <Icon name="play" size={18} />
        <span className="grow"><strong>See how your episodes perform on YouTube.</strong> <span className="muted small">{rows.length} episode{rows.length > 1 ? "s have" : " has"} a YouTube link. Add a free YouTube API key to show views, likes, comments and growth.</span></span>
        <button className="btn btnSm btnPrimary" onClick={() => api.go("settings", { tab: "youtube" })}>Set up</button>
      </div>
    );
  }
  const total = live.reduce((a, r) => a + r.v.views, 0);
  const week = live.reduce((a, r) => a + (growth(r.v, 7)?.views || 0), 0);
  const top = [...live].sort((a, b) => b.v.views - a.v.views)[0];
  const key = (r) => (sort === "week" ? growth(r.v, 7)?.views ?? -1 : sort === "early" ? earlyViews(r.v, 7) ?? -1 : sort === "likes" ? r.v.likes ?? -1 : r.v.views);
  const ranked = [...live].sort((a, b) => key(b) - key(a));
  return (
    <section className="card ytPerf">
      <div className="cardHead">
        <div>
          <h3><Icon name="trend" size={16} /> Podcast performance</h3>
          <p className="muted small">YouTube views, likes and comments · updated {yt.fetchedAt ? fmtDate(yt.fetchedAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "never"}</p>
        </div>
        <button className="btn btnSm" onClick={refresh} disabled={busy}>{busy ? <span className="btnSpinner" aria-hidden /> : <Icon name="refresh" size={13} />}Refresh</button>
      </div>
      {yt.error && <div className="alert alertWarn">{yt.error}</div>}
      <div className="ytTiles">
        <div><b>{fmtN(total)}</b><span>Total views</span></div>
        <div><b>{week ? `+${fmtN(week)}` : "–"}</b><span>Views this week</span></div>
        <div><b>{live.length ? fmtN(Math.round(total / live.length)) : "–"}</b><span>Average per episode</span></div>
        <div className="ytTop">{top ? <><b className="ellipsis">{top.g.name}</b><span>Top episode · {fmtN(top.v.views)} views</span></> : <><b>–</b><span>Top episode</span></>}</div>
      </div>
      {live.length > 0 && (
        <>
          <div className="row gap8 wrap ytSortRow">
            <span className="muted small">Rank by</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="views">All-time views</option>
              <option value="week">Views this week</option>
              <option value="early">Views in first 7 days</option>
              <option value="likes">Likes</option>
            </select>
          </div>
          <ol className="ytRank">
            {ranked.map((r, i) => {
              const gr = growth(r.v, 7), ev = earlyViews(r.v, 7);
              return (
                <li key={r.id}>
                  <span className="ytPos">{i + 1}</span>
                  <a href={`https://youtu.be/${r.id}`} target="_blank" rel="noreferrer" className="ytThumb">
                    {r.v.thumb ? <img src={r.v.thumb} alt="" /> : <Icon name="play" size={18} />}
                    {r.v.seconds ? <span>{fmtDur(r.v.seconds)}</span> : null}
                  </a>
                  <button className="ytMain" onClick={() => api.open(r.g.id)}>
                    <strong className="ellipsis">{r.v.title || r.g.name}</strong>
                    <span className="muted tiny">EP {String(r.no).padStart(2, "0")} · {r.g.name}{r.v.publishedAt ? ` · published ${fmtDate(r.v.publishedAt)}` : ""}</span>
                  </button>
                  <span className="ytNums">
                    <span><b>{fmtN(r.v.views)}</b> views</span>
                    <span className="muted tiny">{r.v.likes != null ? `${fmtN(r.v.likes)} likes` : "likes hidden"} · {r.v.comments != null ? `${fmtN(r.v.comments)} comments` : "comments off"}</span>
                    <span className="muted tiny">{gr ? `+${fmtN(gr.views)} this week` : "growth after 2 days of data"}{ev != null ? ` · ${fmtN(ev)} in first week` : ""}</span>
                  </span>
                  <button className="btn btnSm" disabled={!r.v.comments} onClick={() => onComments(r)}><Icon name="comment" size={13} />Comments</button>
                </li>
              );
            })}
          </ol>
          {traits.length > 0 && (
            <div className="ytTraits">
              <span className="eyebrow">Which guests get more views</span>
              {traits.slice(0, 4).map((t) => (
                <p key={t.label + t.value} className="small"><strong>{t.value}</strong> <span className="muted">({t.label.toLowerCase()})</span>: {t.times >= 1 ? `${t.times.toFixed(1)}× the average` : `${Math.round(t.times * 100)}% of the average`} · {fmtN(t.avg)} views on {t.views.length} episodes</p>
              ))}
            </div>
          )}
        </>
      )}
      {rows.length > live.length && <p className="muted tiny">{rows.length - live.length} linked video{rows.length - live.length > 1 ? "s" : ""} not loaded yet{rows.some((r) => r.v?.missing) ? " (one or more look private or have a wrong link)" : ""}.</p>}
    </section>
  );
}

// Latest comments with an AI summary of what viewers liked and asked.
function CommentsDrawer({ row, onClose, flash }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async (summarize) => {
    setBusy(true);
    try {
      const r = await fetch("/api/youtube", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "comments", id: row.id, summarize }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setData((x) => ({ ...x, ...d, insight: d.insight || x?.insight || row.v.insight }));
    } catch (e) { flash?.(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { load(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ins = data?.insight || row.v.insight;
  return (
    <Drawer onClose={onClose} label="Episode comments">
      <div className="drawerBody stack16" style={{ padding: 24 }}>
        <div>
          <h2>Comments</h2>
          <p className="muted small">{row.v.title}</p>
        </div>
        <div className="card ytInsight">
          {ins ? (
            <>
              <div className="row gap8"><span className="eyebrow">What viewers say</span><span className="tgChip">{ins.sentiment}</span><span className="muted tiny push">from {ins.basedOn} comments</span></div>
              <p className="small">{ins.summary}</p>
              {ins.liked?.length > 0 && <><span className="muted tiny">Liked</span><ul className="small">{ins.liked.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
              {ins.questions?.length > 0 && <><span className="muted tiny">Asked for (ideas for future episodes)</span><ul className="small">{ins.questions.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
            </>
          ) : <p className="muted small">Get a short AI summary of what viewers liked and asked about (1 AI request).</p>}
          <button className="btn btnSm" disabled={busy || !data?.comments?.length} onClick={() => load(true)}>{busy ? <span className="btnSpinner" aria-hidden /> : <Icon name="sparkle" size={13} />}{ins ? "Summarise again" : "Summarise with AI"}</button>
        </div>
        {!data ? <p className="muted small">Loading comments…</p> : (
          <ul className="ytComments">
            {(data.comments || []).map((c, i) => (
              <li key={i}><strong className="small">{c.author}</strong><span className="muted tiny"> · {fmtDate(c.at)}{c.likes ? ` · ${c.likes} likes` : ""}</span><p className="small">{c.text}</p></li>
            ))}
            {data.comments?.length === 0 && <p className="muted small">No comments yet.</p>}
          </ul>
        )}
      </div>
    </Drawer>
  );
}

// Episode order: the number you set wins; otherwise episodes are numbered by recording date.
export function orderEpisodes(guests) {
  const byDate = guests
    .filter(isRecorded)
    .sort((a, b) => String(a.episode?.recordedAt || "").localeCompare(String(b.episode?.recordedAt || "")) || String(a.updatedAt || "").localeCompare(String(b.updatedAt || "")));
  return byDate
    .map((g, i) => ({ g, key: g.episode?.number ?? i + 1, i }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map((x, i) => ({ g: x.g, no: i + 1 }));
}

// Accepted and scheduled guests, soonest recording first.
function UpcomingList({ list, api }) {
  if (!list.length) return <p className="muted small card pad16">No upcoming recordings. When a guest accepts, they show up here; set the recording date in their Episode tab.</p>;
  return (
    <div className="upList">
      {list.map((g) => {
        const ep = g.episode || {};
        const d = ep.scheduledAt ? new Date(ep.scheduledAt) : null;
        const past = d && d.getTime() < Date.now();
        return (
          <article key={g.id} className="upCard card" onClick={() => api.open(g.id, "Episode")}>
            <div className={`upDate${d ? "" : " none"}${past ? " past" : ""}`}>
              {d ? <><b>{d.getDate()}</b><span>{d.toLocaleDateString("en-IN", { month: "short" })}</span><small>{d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</small></> : <><Icon name="calendar" size={18} /><small>No date</small></>}
            </div>
            <GuestPhoto g={g} size={44} />
            <div className="grow upMain">
              <strong>{g.name}</strong>
              <span className="muted small ellipsis">{g.role}</span>
              <CompanyName name={g.company} domain={g.companyDomain} size={14} />
            </div>
            <div className="upMeta">
              <StageBadge stage={g.stage} />
              <span className="muted tiny">{d ? `${ep.mode || "Online"}${past ? " · date passed" : ""}` : "Set the recording date"}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default function Archive({ guests, api, flash }) {
  const [editing, setEditing] = useState(null);
  const [moving, setMoving] = useState(false);
  const [view, setView] = useViewPref("episodes", "cards");
  const { yt, busy: ytBusy, refresh: ytRefresh } = useYouTube();
  const [commentsFor, setCommentsFor] = useState(null);
  const vOf = (g) => yt?.videos?.[episodeVideoId(g.episode)];
  const ordered = orderEpisodes(guests); // oldest → newest
  const [phase, setPhase] = useViewPref("episodes-phase", "all");
  const upcoming = guests
    .filter((g) => g.stage === "Scheduled" || g.stage === "Accepted")
    .sort((a, b) => (Date.parse(a.episode?.scheduledAt || "") || 9e15) - (Date.parse(b.episode?.scheduledAt || "") || 9e15));
  const inProd = (g) => ["Recorded", "Editing", "Ready to publish"].includes(g.stage);
  const shown = [...ordered].reverse().filter(({ g }) => phase === "all" || (phase === "production" ? inProd(g) : phase === "published" ? g.stage === "Published" : true));

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

  if (!ordered.length && !upcoming.length) {
    return (
      <Empty icon="archive" title="No episodes yet" action={<button className="btn" onClick={() => api.go("pipeline")}>Open pipeline</button>}>
        When a guest says yes, they appear here under Upcoming. Recorded and published episodes follow, with guest and company details.
      </Empty>
    );
  }

  const published = ordered.filter((x) => x.g.episode?.published).length;

  return (
    <div className="stack12">
      <div className="row gap8 wrap">
        <Segmented value={phase} onChange={setPhase} options={[
          { value: "upcoming", label: "Upcoming", count: upcoming.length },
          { value: "production", label: "In production", count: ordered.filter(({ g }) => inProd(g)).length },
          { value: "published", label: "Published", count: published },
          { value: "all", label: "All recorded", count: ordered.length },
        ]} />
        <span className="grow" />
        <ViewSwitch value={view} onChange={setView} options={["cards", "grid", "list"]} />
        <button className="btn btnSm" onClick={() => exportCSV(ordered.map((x) => x.g), "recorded-episodes")}><Icon name="download" size={14} />Export</button>
      </div>
      {phase === "upcoming" ? (
        <UpcomingList list={upcoming} api={api} />
      ) : (
      <>
      <Performance ordered={ordered} yt={yt} busy={ytBusy} refresh={ytRefresh} api={api} onComments={setCommentsFor} />
      {commentsFor && <CommentsDrawer row={commentsFor} onClose={() => setCommentsFor(null)} flash={flash} />}

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
                  <StatLine v={vOf(g)} />
                </div>
                <span className="epRowCo hideSm"><CompanyName name={g.company} domain={g.companyDomain} /><PastCompanies g={g} variant="logos" size={14} /></span>
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
                <span className="epTilePast"><PastCompanies g={g} variant="logos" size={15} /></span>
                <StatLine v={vOf(g)} compact />
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
                <span className={`epPub${g.stage === "Published" ? " on" : ""}`}>{g.stage === "Published" ? "Published" : g.stage === "Ready to publish" ? "Ready" : g.stage}</span>
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
                <h3 className="epTitle">{ep.title || episodeTopic(g.result?.hook) || `Episode with ${g.name}`}</h3>
                {ep.title && episodeTopic(g.result?.hook) && <p className="muted small epHook">{episodeTopic(g.result?.hook)}</p>}
                <div className="epWho">
                <p className="epGuest" title={`${g.name} · ${g.role}`}><strong>{g.name}</strong> · {g.role}</p>
                <CompanyName name={g.company} domain={g.companyDomain} />
                <div className="epPast"><PastCompanies g={g} max={2} /></div>
                </div>
                <StatLine v={vOf(g)} />
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

      {!shown.length && <p className="muted small card pad16">No episodes in this group yet.</p>}
      </>
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
