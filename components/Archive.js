"use client";

import Icon from "./icons";
import { Avatar, CompanyName, Empty, fmtDate } from "./ui";
import { exportCSV } from "./Guests";

export default function Archive({ guests, api }) {
  const recorded = guests
    .filter((g) => g.stage === "Recorded")
    .sort((a, b) => String(b.episode?.recordedAt || "").localeCompare(String(a.episode?.recordedAt || "")));

  if (!recorded.length) {
    return (
      <Empty icon="archive" title="No recorded episodes yet" action={<button className="btn" onClick={() => api.go("pipeline")}>Open pipeline</button>}>
        When you move a guest to Recorded, their episode appears here with guest and company details.
      </Empty>
    );
  }

  return (
    <div className="stack12">
      <div className="row gap8">
        <p className="muted small grow">{recorded.length} episode{recorded.length > 1 ? "s" : ""} recorded</p>
        <button className="btn btnSm" onClick={() => exportCSV(recorded, "recorded-episodes")}><Icon name="download" size={14} />Export</button>
      </div>
      <div className="archiveGrid">
        {recorded.map((g, i) => (
          <article key={g.id} className="episode" onClick={() => api.open(g.id)}>
            <div className="epCover" style={{ "--seed": (i * 47) % 360 }}>
              <span className="epNo">EP {String(recorded.length - i).padStart(2, "0")}</span>
              <Avatar name={g.name} src={g.photoUrl} alt={g.gravatarUrl} size={72} ring />
            </div>
            <div className="epBody">
              <span className="muted tiny">{g.episode?.recordedAt ? fmtDate(g.episode.recordedAt) : "Date not set"}</span>
              <h3>{g.episode?.title || `Episode with ${g.name}`}</h3>
              {!g.episode?.title && g.result?.hook && <p className="muted small">{g.result.hook.charAt(0).toUpperCase() + g.result.hook.slice(1)}</p>}
              <p className="epGuest"><strong>{g.name}</strong> · {g.role}</p>
              <CompanyName name={g.company} domain={g.companyDomain} />
              <div className="row gap8 epActions">
                {g.episode?.link ? (
                  <a className="btn btnSm" href={/^https?:/.test(g.episode.link) ? g.episode.link : `https://${g.episode.link}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                    <Icon name="play" size={13} />Watch
                  </a>
                ) : (
                  <span className="muted tiny">Add the episode link in the guest&apos;s Episode tab</span>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
