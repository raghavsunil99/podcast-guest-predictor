"use client";

import { useMemo, useState } from "react";
import Icon from "./icons";
import { Avatar, CompanyLogo, Drawer, Empty, StageBadge, TierBadge, pct } from "./ui";
import { GuestChip } from "./Pipeline";
import { exportCSV } from "./Guests";
import { groupCompanies, normText } from "@/lib/crm";

export default function Companies({ guests, api }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("guests");
  const [openKey, setOpenKey] = useState(null);
  const companies = useMemo(() => groupCompanies(guests), [guests]);
  const list = companies
    .filter((c) => !q || normText(c.name + " " + (c.industry || "")).includes(normText(q)))
    .sort((a, b) =>
      sort === "recorded" ? b.recorded - a.recorded || b.guests - a.guests
        : sort === "score" ? (b.avgScore ?? 0) - (a.avgScore ?? 0)
          : sort === "open" ? b.open - a.open
            : b.guests - a.guests
    );
  const open = companies.find((c) => c.key === openKey);

  if (!companies.length) {
    return <Empty icon="building" title="No companies yet" action={<button className="btn btnPrimary" onClick={() => api.go("discover")}><Icon name="plus" size={16} />Study a profile</button>}>Companies appear here as you study guests from them.</Empty>;
  }

  return (
    <div className="stack12">
      <div className="row gap8 wrap">
        <div className="inputIcon searchBox grow">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies or industries" />
        </div>
        <label className="sortSel">
          <span className="muted small">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="guests">Most guests</option>
            <option value="recorded">Most recorded</option>
            <option value="score">Highest avg. score</option>
            <option value="open">Most not yet contacted</option>
          </select>
        </label>
      </div>

      <div className="companyGrid">
        {list.map((c) => (
          <button key={c.key} className="companyCard" onClick={() => setOpenKey(c.key)}>
            <div className="ccHead">
              <CompanyLogo name={c.name} domain={c.domain} size={40} />
              <div className="ccName">
                <strong>{c.name}</strong>
                <span className="muted small">{c.industry || c.domain || "—"}</span>
              </div>
            </div>
            <div className="ccStats">
              <div><b>{c.guests}</b><span>Guests</span></div>
              <div><b>{c.contacted}</b><span>Contacted</span></div>
              <div><b>{c.recorded}</b><span>Recorded</span></div>
              <div><b>{c.avgScore ?? "–"}</b><span>Avg score</span></div>
            </div>
            <div className="ccFoot">
              <div className="avatarStack">
                {c.members.slice(0, 4).map((m) => <Avatar key={m.id} name={m.name} src={m.photoUrl} size={26} ring />)}
                {c.members.length > 4 && <span className="more">+{c.members.length - 4}</span>}
              </div>
              {c.open > 0 && <span className="openTag">{c.open} not contacted</span>}
            </div>
          </button>
        ))}
      </div>

      {open && (
        <Drawer onClose={() => setOpenKey(null)} label={`${open.name} guests`}>
          <div className="drawerTop">
            <div className="guestHead">
              <CompanyLogo name={open.name} domain={open.domain} size={56} />
              <div className="guestHeadText">
                <h2>{open.name}</h2>
                <p className="muted">{[open.industry, open.domain].filter(Boolean).join(" · ")}</p>
              </div>
              <button className="iconBtn" onClick={() => setOpenKey(null)} aria-label="Close"><Icon name="x" /></button>
            </div>
            <div className="miniStats">
              <div><b>{open.guests}</b><span>Discovered</span></div>
              <div><b>{open.contacted}</b><span>Contacted</span></div>
              <div><b>{open.recorded}</b><span>Recorded</span></div>
              <div><b>{pct(open.guests ? open.recorded / open.guests : 0)}</b><span>Conversion</span></div>
            </div>
          </div>
          <div className="drawerBody stack8">
            {[...open.members].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((m) => (
              <div key={m.id} className="listRow">
                <GuestChip g={m} onOpen={(id) => { setOpenKey(null); api.open(id); }} extra={<span className="row gap6"><StageBadge stage={m.stage} /><TierBadge guest={m} short /></span>} />
              </div>
            ))}
          </div>
          <div className="drawerFoot">
            <button className="btn btnSm" onClick={() => exportCSV(open.members, `guests-${open.name.toLowerCase().replace(/\W+/g, "-")}`)}>
              <Icon name="download" size={14} />Export {open.name} guests
            </button>
          </div>
        </Drawer>
      )}
    </div>
  );
}
