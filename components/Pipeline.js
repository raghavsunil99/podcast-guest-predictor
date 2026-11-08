"use client";

import { useState } from "react";
import Icon from "./icons";
import { Avatar, CompanyLogo, Empty, ScoreRing } from "./ui";
import { SIDE_STAGES, STAGES, STAGE_HINT, daysSince, stageClass, tierOf } from "@/lib/crm";

export function GuestChip({ g, onOpen, extra, showRing = true }) {
  return (
    <button className="guestChip" onClick={() => onOpen(g.id)}>
      <Avatar name={g.name} src={g.photoUrl} alt={g.gravatarUrl} size={34} />
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

export default function Pipeline({ guests, api, settings }) {
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const [showSide, setShowSide] = useState(false);
  const cols = showSide ? [...STAGES, ...SIDE_STAGES] : STAGES;
  const sideCount = guests.filter((g) => SIDE_STAGES.includes(g.stage)).length;
  const days = settings.followUpDays || 5;

  if (!guests.length) {
    return <Empty icon="pipeline" title="Your pipeline is empty" action={<button className="btn btnPrimary" onClick={() => api.go("discover")}><Icon name="plus" size={16} />Study a profile</button>}>Every profile you study lands here as Discovered. Drag guests across stages as you reach out.</Empty>;
  }

  return (
    <div className="stack12">
      <div className="row gap8 wrap">
        <p className="muted small grow">Drag cards between stages, or open a guest to change their stage.</p>
        <label className="switch small">
          <input type="checkbox" checked={showSide} onChange={(e) => setShowSide(e.target.checked)} />
          <span className="switchTrack" aria-hidden />
          <span>Show contact later, not responded and rejected ({sideCount})</span>
        </label>
      </div>
      <div className="board">
        {cols.map((stage) => {
          const list = guests
            .filter((g) => g.stage === stage)
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
          return (
            <section
              key={stage}
              className={`column${SIDE_STAGES.includes(stage) ? " sideCol" : ""}${over === stage ? " dropOver" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(stage);
              }}
              onDragLeave={() => setOver((o) => (o === stage ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/plain") || dragId;
                const g = guests.find((x) => x.id === id);
                if (g && g.stage !== stage) api.patch(id, { stage });
              }}
            >
              <header className="colHead">
                <span className={`colDot ${stageClass(stage)}`} aria-hidden />
                <strong>{stage}</strong>
                <span className="colCount">{list.length}</span>
              </header>
              <p className="colHint">{STAGE_HINT[stage]}</p>
              <div className="colBody">
                {list.map((g) => {
                  const waiting = stage === "Contacted" ? daysSince(g.lastFollowUpAt || g.milestones?.Contacted) : null;
                  return (
                    <article
                      key={g.id}
                      className={`kCard tierEdge-${typeof g.score === "number" ? tierOf(g) : "None"}${dragId === g.id ? " dragging" : ""}`}
                      draggable
                      onDragStart={(e) => {
                        setDragId(g.id);
                        e.dataTransfer.setData("text/plain", g.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => setDragId(null)}
                    >
                      <GuestChip
                        g={g}
                        onOpen={api.open}
                        extra={
                          waiting != null && waiting >= days ? (
                            <span className="dueTag"><Icon name="bell" size={11} />Follow up · {waiting}d</span>
                          ) : g.episode?.recordedAt && stage === "Recorded" ? (
                            <span className="muted tiny">Recorded {g.episode.recordedAt}</span>
                          ) : null
                        }
                      />
                    </article>
                  );
                })}
                {!list.length && <div className="colEmpty">Drop here</div>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
