"use client";

import { useMemo, useState } from "react";
import Icon from "./icons";
import { Avatar, CompanyName, Empty, ScoreRing, StageBadge, TierBadge, timeAgo } from "./ui";
import { ALL_STAGES, findDuplicates, normText, tierOf, toCSV } from "@/lib/crm";

const uniq = (list) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));

export function exportCSV(guests, name = "podcast-guests") {
  const blob = new Blob(["﻿" + toCSV(guests)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const SORTS = {
  score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
  recent: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)),
  name: (a, b) => a.name.localeCompare(b.name),
  company: (a, b) => String(a.company).localeCompare(String(b.company)),
};

export default function Guests({ guests, api, initialFilter }) {
  const [q, setQ] = useState("");
  const [f, setF] = useState({ company: "", city: "", industry: "", stage: "", tier: "", role: "", past: "", college: "", move: "", ...(initialFilter || {}) });
  const [sort, setSort] = useState("score");
  const [dupOnly, setDupOnly] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [removing, setRemoving] = useState(false);

  const dups = useMemo(() => findDuplicates(guests), [guests]);
  const dupIds = useMemo(() => new Set(dups.flat().map((g) => g.id)), [dups]);
  const opts = useMemo(
    () => ({
      company: uniq(guests.map((g) => g.company)),
      city: uniq(guests.map((g) => g.city)),
      industry: uniq(guests.map((g) => g.industry || g.domain)),
      past: uniq(guests.flatMap((g) => g.pastCompanies || [])),
      college: uniq(guests.flatMap((g) => g.colleges || [])),
      move: uniq(guests.flatMap((g) => (g.careerTags || []).filter((t) => !t.startsWith("Promoted") && t !== "Long tenure"))),
    }),
    [guests]
  );

  const list = useMemo(() => {
    const nq = normText(q);
    const nr = normText(f.role);
    return guests
      .filter((g) => !dupOnly || dupIds.has(g.id))
      .filter((g) => !nq || normText([g.name, g.role, g.company, g.city, g.domain, g.language, ...(g.pastCompanies || []), ...(g.colleges || [])].join(" ")).includes(nq))
      .filter((g) => !nr || normText(g.role).includes(nr))
      .filter((g) => !f.company || g.company === f.company)
      .filter((g) => !f.city || g.city === f.city)
      .filter((g) => !f.industry || (g.industry || g.domain) === f.industry)
      .filter((g) => !f.stage || g.stage === f.stage)
      .filter((g) => !f.tier || tierOf(g) === f.tier)
      .filter((g) => !f.past || (g.pastCompanies || []).includes(f.past))
      .filter((g) => !f.college || (g.colleges || []).includes(f.college))
      .filter((g) => !f.move || (g.careerTags || []).includes(f.move))
      .sort(SORTS[sort]);
  }, [guests, q, f, sort, dupOnly, dupIds]);

  const visibleIds = list.map((g) => g.id);
  const sel = visibleIds.filter((id) => selected.has(id));
  const allOn = visibleIds.length > 0 && sel.length === visibleIds.length;
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(visibleIds));
  async function removeSelected() {
    const names = list.filter((g) => selected.has(g.id)).map((g) => g.name);
    if (!names.length) return;
    const preview = names.slice(0, 5).join(", ") + (names.length > 5 ? ` and ${names.length - 5} more` : "");
    if (!confirm(`Remove ${names.length} guest${names.length > 1 ? "s" : ""} (${preview})?\n\nTheir notes, history and photos are deleted too. This can't be undone.`)) return;
    setRemoving(true);
    for (const id of sel) await api.remove(id);
    setSelected(new Set());
    setRemoving(false);
  }
  async function moveSelected(stage) {
    for (const id of sel) await api.patch(id, { stage });
    setSelected(new Set());
  }

  const active = Object.values(f).filter(Boolean).length + (q ? 1 : 0) + (dupOnly ? 1 : 0);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  if (!guests.length) {
    return <Empty icon="users" title="No guests yet" action={<button className="btn btnPrimary" onClick={() => api.go("discover")}><Icon name="plus" size={16} />Study a profile</button>}>Study a LinkedIn profile and it will appear here.</Empty>;
  }

  return (
    <div className="stack12">
      {dups.length > 0 && (
        <div className="alert alertWarn row gap8 wrap">
          <Icon name="users" size={16} />
          <span className="grow">
            <strong>{dups.length} possible duplicate{dups.length > 1 ? "s" : ""}</strong>: {dups.map((d) => d[0].name).join(", ")}. Same name or LinkedIn URL appears more than once.
          </span>
          <button className="btn btnSm" onClick={() => setDupOnly((v) => !v)}>{dupOnly ? "Show all" : "Review"}</button>
        </div>
      )}

      <div className="filterBar">
        <div className="inputIcon searchBox">
          <Icon name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, role, company, city…" />
        </div>
        <input className="fSelect" value={f.role} onChange={set("role")} placeholder="Designation" />
        <select className="fSelect" value={f.company} onChange={set("company")}>
          <option value="">All companies</option>
          {opts.company.map((o) => <option key={o}>{o}</option>)}
        </select>
        <select className="fSelect" value={f.city} onChange={set("city")}>
          <option value="">All locations</option>
          {opts.city.map((o) => <option key={o}>{o}</option>)}
        </select>
        <select className="fSelect" value={f.industry} onChange={set("industry")}>
          <option value="">All industries</option>
          {opts.industry.map((o) => <option key={o}>{o}</option>)}
        </select>
        <select className="fSelect" value={f.tier} onChange={set("tier")}>
          <option value="">Any score</option>
          <option value="High">High potential (65+)</option>
          <option value="Medium">Medium (45–64)</option>
          <option value="Low">Low (under 45)</option>
        </select>
        {opts.past.length > 0 && (
          <select className="fSelect" value={f.past} onChange={set("past")}>
            <option value="">Any previous company</option>
            {opts.past.map((o) => <option key={o}>{o}</option>)}
          </select>
        )}
        {opts.college.length > 0 && (
          <select className="fSelect" value={f.college} onChange={set("college")}>
            <option value="">Any college</option>
            {opts.college.map((o) => <option key={o}>{o}</option>)}
          </select>
        )}
        {opts.move.length > 0 && (
          <select className="fSelect" value={f.move} onChange={set("move")}>
            <option value="">Any career pattern</option>
            {opts.move.map((o) => <option key={o}>{o}</option>)}
          </select>
        )}
        <select className="fSelect" value={f.stage} onChange={set("stage")}>
          <option value="">All stages</option>
          {ALL_STAGES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      {sel.length > 0 && (
        <div className="bulkBar">
          <strong>{sel.length} selected</strong>
          <button className="linkBtn" onClick={() => setSelected(new Set())}>Clear</button>
          <span className="push" />
          <select className="fSelect" value="" onChange={(e) => e.target.value && moveSelected(e.target.value)} aria-label="Move selected to stage">
            <option value="">Move to…</option>
            {ALL_STAGES.map((st) => <option key={st}>{st}</option>)}
          </select>
          <button className="btn btnSm btnDanger" onClick={removeSelected} disabled={removing}>
            {removing ? <span className="btnSpinner" /> : <Icon name="trash" size={14} />}Remove selected
          </button>
        </div>
      )}

      <div className="row gap8 wrap listBar">
        <span className="muted small">
          {list.length} of {guests.length} guests
          {active > 0 && (
            <button className="linkBtn" onClick={() => { setQ(""); setDupOnly(false); setF({ company: "", city: "", industry: "", stage: "", tier: "", role: "", past: "", college: "", move: "" }); }}>
              · Clear filters
            </button>
          )}
        </span>
        <label className="sortSel push">
          <span className="muted small">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="score">Prediction score</option>
            <option value="recent">Recently updated</option>
            <option value="name">Name</option>
            <option value="company">Company</option>
          </select>
        </label>
        <button className="btn btnSm" onClick={() => exportCSV(list)} disabled={!list.length}>
          <Icon name="download" size={14} />Export {active ? "filtered" : "all"} (CSV/Excel)
        </button>
      </div>

      <div className="tableWrap card flush">
        <table className="gTable">
          <thead>
            <tr>
              <th className="chkCell"><input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Select all shown guests" /></th>
              <th>Guest</th>
              <th>Company</th>
              <th className="hideSm">Location</th>
              <th className="hideSm">Language</th>
              <th>Score</th>
              <th>Stage</th>
              <th className="hideSm">Updated</th>
            </tr>
          </thead>
          <tbody>
            {list.map((g) => (
              <tr key={g.id} className={selected.has(g.id) ? "rowSel" : ""} onClick={() => api.open(g.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && api.open(g.id)}>
                <td className="chkCell" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggle(g.id)} aria-label={`Select ${g.name}`} />
                </td>
                <td>
                  <div className="cellGuest">
                    <Avatar name={g.name} src={g.photoUrl} alt={g.gravatarUrl} size={34} />
                    <div>
                      <strong>{g.name}{dupIds.has(g.id) && <span className="dupTag">Duplicate?</span>}</strong>
                      <span className="muted small ellipsis">{g.role}</span>
                    </div>
                  </div>
                </td>
                <td><CompanyName name={g.company} domain={g.companyDomain} /></td>
                <td className="hideSm">{g.city || <span className="muted">—</span>}</td>
                <td className="hideSm">{g.language || <span className="muted">—</span>}</td>
                <td>
                  <div className="cellScore">
                    <ScoreRing score={g.score} likelihood={g.likelihood} size={34} stroke={4} label={false} animate={false} />
                    <TierBadge guest={g} short />
                  </div>
                </td>
                <td><StageBadge stage={g.stage} /></td>
                <td className="hideSm muted small">{timeAgo(g.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <p className="muted center pad24">No guests match these filters.</p>}
      </div>
    </div>
  );
}
