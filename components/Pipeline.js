"use client";

import { useState } from "react";
import Icon from "./icons";
import GuestPhoto from "./GuestPhoto";
import { Avatar, CompanyLogo, Empty, ScoreRing } from "./ui";
import { SIDE_STAGES, STAGES, STAGE_HINT, daysSince, stageClass, tierOf } from "@/lib/crm";

export function GuestChip({ g, onOpen, extra, showRing = true }) {
  return (
    <button className="guestChip" onClick={() => onOpen(g.id)}>
      <GuestPhoto g={g} size={34} />
      <span className="gcText">
        <strong>{g.name}</strong>
        <span className="gcSub">
          {g.company && <CompanyLogo name={g.company} domain={g.companyDomain} size={14} />}
          <span className="ellipsis">{[g.role, g.company].filter(Boolean).join(" · ")}</span>
        </span>
        {extra}
      </span>
      {showRing && <ScoreRing score={g.score} likelihood={g.likelihood} size={36} stroke={4} label={false} animate={false} />}
    </button>
  );
}

function MiniCard({ g, stage, days, api, dragId, setDragId, marker, setMarker }) {
  const waiting = stage === "Contacted" ? daysSince(g.lastFollowUpAt || g.milestones?.Contacted) : null;
  const scored = typeof g.score === "number";
  const tier = scored ? tierOf(g) : "None";
  return (
    <article
      className={`kCard tierEdge-${tier}${dragId === g.id ? " dragging" : ""}${marker?.id === g.id ? (marker.before ? " dropBefore" : " dropAfter") : ""}`}
      draggable
      onDragStart={(e) => {
        setDragId(g.id);
        e.dataTransfer.setData("text/plain", g.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => { setDragId(null); setMarker(null); }}
      onDragOver={(e) => {
        if (!dragId || dragId === g.id) return;
        const r = e.currentTarget.getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2;
        if (marker?.id !== g.id || marker.before !== before) setMarker({ id: g.id, before, stage });
      }}
      data-drop={marker?.id === g.id ? (marker.before ? "before" : "after") : undefined}
    >
      <button className="kMain" onClick={() => api.open(g.id)}>
        <GuestPhoto g={g} size={30} />
        <span className="kText">
          <strong>{g.name}</strong>
          <span className="kSub">
            {g.company && <CompanyLogo name={g.company} domain={g.companyDomain} size={13} />}
            <span className="ellipsis">{g.company || g.role || "—"}</span>
          </span>
        </span>
        <span className={`kScore ks-${tier}`} title={scored ? `${g.score}/100` : "Not scored"}>{scored ? g.score : "–"}</span>
      </button>
      {waiting != null && waiting >= days && <span className="dueTag kDue"><Icon name="bell" size={11} />Follow up · {waiting}d</span>}
      <button
        className="cardRemove"
        title={`Remove ${g.name}`}
        aria-label={`Remove ${g.name}`}
        onClick={(e) => {
          e.stopPropagation();
          if (confirm(`Remove ${g.name}? Their notes, history and photo are deleted too.`)) api.remove(g.id);
        }}
      >
        <Icon name="x" size={12} />
      </button>
    </article>
  );
}

export default function Pipeline({ guests, api, settings }) {
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const [marker, setMarker] = useState(null); // { id, before, stage }: where a dragged card will land
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(null); // one stage expanded, or null for all
  const days = settings.followUpDays || 5;

  if (!guests.length) {
    return <Empty icon="pipeline" title="Your pipeline is empty" action={<button className="btn btnPrimary" onClick={() => api.go("discover")}><Icon name="plus" size={16} />Study a profile</button>}>Every profile you study lands here as Discovered. Drag guests across stages as you reach out.</Empty>;
  }

  const nq = q.trim().toLowerCase();
  const shown = nq ? guests.filter((g) => [g.name, g.company, g.role, g.city].join(" ").toLowerCase().includes(nq)) : guests;
  // Your own order (set by dragging) first; guests you haven't placed follow, highest score first.
  const order = (a, b) => {
    const ra = a.boardRank ?? null, rb = b.boardRank ?? null;
    if (ra != null && rb != null) return ra - rb;
    if (ra != null) return -1;
    if (rb != null) return 1;
    return (b.score ?? -1) - (a.score ?? -1);
  };
  const byStage = (st) => shown.filter((g) => g.stage === st).sort(order);
  const fullStage = (st) => guests.filter((g) => g.stage === st).sort(order);

  // Put `id` into `stage` at the marker position and number that stage 1, 2, 3…
  async function place(id, stage) {
    const g = guests.find((x) => x.id === id);
    if (!g) return;
    const list = fullStage(stage).filter((x) => x.id !== id);
    let at = list.length;
    if (marker && marker.stage === stage) {
      const i = list.findIndex((x) => x.id === marker.id);
      if (i >= 0) at = marker.before ? i : i + 1;
    }
    const moved = g.stage !== stage;
    const placed = marker && marker.stage === stage;
    if (!moved && !placed) return;
    list.splice(at, 0, g);
    if (moved) await api.patch(id, { stage, patch: { boardRank: placed ? at + 1 : null } });
    if (!placed) return; // dropped on the column, not between cards: keep score order
    for (let k = 0; k < list.length; k++) {
      const x = list[k];
      if (x.id === id && moved) continue;
      if (x.boardRank !== k + 1) await api.patch(x.id, { patch: { boardRank: k + 1 } });
    }
  }
  async function resetOrder(stage) {
    for (const x of fullStage(stage)) if (x.boardRank != null) await api.patch(x.id, { patch: { boardRank: null } });
  }
  const count = (st) => guests.filter((g) => g.stage === st).length;
  const reachedCount = (st) => guests.filter((g) => g.milestones?.[st]).length;

  const dropProps = (stage) => ({
    onDragOver: (e) => { e.preventDefault(); setOver(stage); },
    onDragLeave: () => setOver((o) => (o === stage ? null : o)),
    onDrop: (e) => {
      e.preventDefault();
      setOver(null);
      const id = e.dataTransfer.getData("text/plain") || dragId;
      place(id, stage).finally(() => setMarker(null));
    },
  });
  const cols = focus ? [focus] : STAGES;

  return (
    <div className="stack12">
      <div className="stageStrip" role="tablist" aria-label="Stages">
        {STAGES.map((st, i) => {
          const conv = i > 0 && reachedCount(STAGES[i - 1]) ? Math.round((reachedCount(st) / reachedCount(STAGES[i - 1])) * 100) : null;
          return (
            <button
              key={st}
              role="tab"
              aria-selected={focus === st}
              className={`stageTab${focus === st ? " on" : ""}${over === st ? " dropOver" : ""}`}
              onClick={() => setFocus(focus === st ? null : st)}
              title={`${STAGE_HINT[st]}. Click to focus, drop a card to move it here.`}
              {...dropProps(st)}
            >
              <span className="stLabel"><span className={`colDot ${stageClass(st)}`} />{st}</span>
              <span className="stCount">{count(st)}</span>
              {conv != null && <span className="stConv" title={`${conv}% of guests who reached ${STAGES[i - 1]} reached ${st}`}>{conv}%</span>}
            </button>
          );
        })}
      </div>

      <div className="row gap8 wrap">
        <div className="inputIcon searchBox boardSearch">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a guest on the board" />
        </div>
        {focus && <button className="btn btnSm" onClick={() => setFocus(null)}><Icon name="x" size={13} />Show all stages</button>}
        <span className="muted small push hideSm">Drag cards between stages · hover a card to remove it</span>
      </div>

      <div
        className={`board${focus ? " focused" : ""}`}
        style={focus ? undefined : { "--cols": cols.map((st) => (byStage(st).length ? "minmax(0, 2.4fr)" : "minmax(92px, 0.6fr)")).join(" ") }}
      >
        {cols.map((stage) => {
          const list = byStage(stage);
          return (
            <section key={stage} className={`column${over === stage ? " dropOver" : ""}${!list.length && !focus ? " isEmpty" : ""}`} title={!list.length ? `${stage}: empty` : undefined} {...dropProps(stage)}>
              <header className="colHead">
                <span className={`colDot ${stageClass(stage)}`} aria-hidden />
                <strong>{stage}</strong>
                <span className="colCount">{list.length}</span>
                {list.some((g) => g.boardRank != null) && (
                  <button className="iconBtn sm" onClick={() => resetOrder(stage)} title="Undo your custom order and sort by score again">
                    <Icon name="refresh" size={13} />
                  </button>
                )}
                {list.length > 0 && (
                  <button className="iconBtn sm colMenu" onClick={() => api.go("guests", { stage })} title={`Select, move or remove ${stage} guests`}>
                    <Icon name="filter" size={13} />
                  </button>
                )}
              </header>
              <div className="colBody">
                {list.map((g) => <MiniCard key={g.id} g={g} stage={stage} days={days} api={api} dragId={dragId} setDragId={setDragId} marker={marker} setMarker={setMarker} />)}
                {!list.length && <div className="colEmpty">{nq ? "No match" : "Drop here"}</div>}
              </div>
            </section>
          );
        })}
      </div>

      <div className="sideTray">
        <span className="trayTitle">Other outcomes</span>
        {SIDE_STAGES.map((st) => {
          const list = byStage(st);
          return (
            <section key={st} className={`trayZone${over === st ? " dropOver" : ""}`} {...dropProps(st)}>
              <header>
                <span className={`colDot ${stageClass(st)}`} />
                <strong>{st}</strong>
                <span className="colCount">{list.length}</span>
              </header>
              <div className="trayChips">
                {list.map((g) => (
                  <button
                    key={g.id}
                    className="trayChip"
                    draggable
                    onDragStart={(e) => { setDragId(g.id); e.dataTransfer.setData("text/plain", g.id); }}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => api.open(g.id)}
                  >
                    <GuestPhoto g={g} size={20} />
                    {g.name}
                  </button>
                ))}
                {!list.length && <span className="muted tiny">Drop a card here</span>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
