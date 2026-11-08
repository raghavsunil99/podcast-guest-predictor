"use client";

import { useEffect, useState } from "react";
import Icon from "./icons";
import { CompanyLogo, Empty, timeAgo } from "./ui";
import { CATEGORIES, SIZES, TARGET_STATUSES, fitLabel } from "@/lib/targets";

// LinkedIn people search, limited to India.
const liPeople = (kw) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(kw)}&geoUrn=%5B%22102713980%22%5D`;
const CITIES = ["Bengaluru", "Hyderabad", "Pune", "Chennai", "Gurugram", "Noida", "Mumbai", "Kochi", "Thiruvananthapuram"];
const LANGS = ["Telugu", "Tamil", "Malayalam", "Kannada", "Hindi", "Marathi"];
const fitTone = (n) => (n >= 80 ? "best" : n >= 65 ? "good" : "try");

function FitBadge({ score }) {
  if (score == null) return null;
  return <span className={`fitBadge ${fitTone(score)}`} title={`Fit score ${score}/100`}><b>{score}</b>{fitLabel(score)}</span>;
}

function RoleLinks({ roles, company }) {
  return (
    <div className="roleLinks">
      {(roles || []).map((r) => (
        <a key={r} href={liPeople(`${r} ${company}`)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{r}<Icon name="external" size={11} /></a>
      ))}
      <a href={liPeople(company)} target="_blank" rel="noreferrer" className="allPeople">All people<Icon name="external" size={11} /></a>
    </div>
  );
}

export default function Targets({ settings, api, flash, onUsageChange }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [f, setF] = useState({ industry: "", city: "", size: "", category: "", language: "", notes: "" });
  const [statusTab, setStatusTab] = useState("All");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    fetch("/api/targets", { cache: "no-store" }).then((r) => r.json()).then((d) => { setData(d); if (d.suggestions?.filters) setF((x) => ({ ...x, ...d.suggestions.filters })); }).catch(() => setData({ pinned: [] }));
  }, []);

  async function post(body) {
    const r = await fetch("/api/targets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Something went wrong.");
    setData(d);
    return d;
  }

  async function suggest() {
    setBusy(true);
    setError("");
    try {
      const d = await post({ action: "suggest", filters: f, settings });
      if (d.notice) flash?.(d.notice);
      onUsageChange?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const act = (body, msg) => post(body).then(() => msg && flash?.(msg)).catch((e) => flash?.(e.message));

  if (!data) return <div className="card pad24 muted">Loading target companies…</div>;

  const pinned = data.pinned || [];
  const counts = Object.fromEntries(TARGET_STATUSES.map((s) => [s, pinned.filter((t) => t.status === s).length]));
  const shownPinned = statusTab === "All" ? pinned : pinned.filter((t) => t.status === statusTab);
  const sug = data.suggestions;
  const activeFilters = Object.values(f).filter(Boolean).length;

  return (
    <div className="stack16 targetsPage">
      {/* Ask the AI */}
      <section className="card tgAsk">
        <div className="row gap12 wrap">
          <div className="grow">
            <h3 className="row gap8"><Icon name="sparkle" size={18} />Find companies to get guests from</h3>
            <p className="muted small">
              The AI looks at who accepted and recorded, your guest criteria and companies you skipped, then ranks companies in India by fit. One AI request.
            </p>
          </div>
          <button className="btn btnPrimary" onClick={suggest} disabled={busy}>
            {busy ? <span className="btnSpinner" aria-hidden /> : <Icon name={sug ? "refresh" : "sparkle"} size={15} />}
            {busy ? "Finding companies…" : sug ? "Suggest again" : "Suggest companies"}
          </button>
        </div>
        <div className="tgFilters">
          <input className="fSelect" value={f.industry} onChange={set("industry")} placeholder="Industry (e.g. fintech, AI)" />
          <select className="fSelect" value={f.city} onChange={set("city")}>
            <option value="">Any city</option>
            {CITIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className="fSelect" value={f.size} onChange={set("size")}>
            <option value="">Any size</option>
            {SIZES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className="fSelect" value={f.category} onChange={set("category")}>
            <option value="">Any type</option>
            {CATEGORIES.filter((c) => c !== "Other").map((c) => <option key={c}>{c}</option>)}
          </select>
          <select className="fSelect" value={f.language} onChange={set("language")}>
            <option value="">Any language</option>
            {LANGS.map((c) => <option key={c} value={c}>{c}-speaking teams</option>)}
          </select>
          <input className="fSelect grow" value={f.notes} onChange={set("notes")} placeholder="Anything else? e.g. women in leadership, ex-founders" />
          {activeFilters > 0 && <button className="linkBtn small" onClick={() => setF({ industry: "", city: "", size: "", category: "", language: "", notes: "" })}>Clear</button>}
        </div>
        {error && <div className="alert alertError">{error}</div>}
      </section>

      {/* Pinned targets */}
      <section className="stack12">
        <div className="row gap8 wrap">
          <h3 className="grow">Your target companies <span className="muted small">· {pinned.length}</span></h3>
          {pinned.length > 0 && (
            <div className="segmented">
              {["All", ...TARGET_STATUSES].map((s) => (
                <button key={s} className={statusTab === s ? "on" : ""} onClick={() => setStatusTab(s)}>
                  {s}<span className="segCount">{s === "All" ? pinned.length : counts[s]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {!pinned.length ? (
          <p className="muted small card pad16">No targets yet. Click <strong>Add to targets</strong> on a suggestion below to start tracking it.</p>
        ) : (
          <div className="tgGrid">
            {shownPinned.map((t) => (
              <article key={t.key} className={`tgCard pinned st-${TARGET_STATUSES.indexOf(t.status)}`}>
                <div className="tgHead">
                  <CompanyLogo name={t.name} domain={t.domain} size={42} />
                  <div className="grow">
                    <strong>{t.name}</strong>
                    <span className="muted tiny block">{[t.industry, t.indiaCities?.slice(0, 2).join(", ")].filter(Boolean).join(" · ")}</span>
                  </div>
                  <FitBadge score={t.fitScore} />
                </div>
                <div className="tgProgress">
                  <span><b>{t.progress.found}</b> studied</span>
                  <span><b>{t.progress.contacted}</b> contacted</span>
                  <span><b>{t.progress.recorded}</b> recorded</span>
                  {t.progress.former > 0 && <span className="muted">+{t.progress.former} former</span>}
                </div>
                <div className="tgSteps" role="group" aria-label="Status">
                  {TARGET_STATUSES.map((s, i) => (
                    <button key={s} className={`tgStep${TARGET_STATUSES.indexOf(t.status) >= i ? " done" : ""}${t.status === s ? " cur" : ""}`} onClick={() => act({ action: "status", key: t.key, status: s })} title={`Set to ${s}`}>
                      {s}
                    </button>
                  ))}
                </div>
                <RoleLinks roles={t.roles} company={t.name} />
                <div className="tgFoot">
                  {t.progress.found > 0 && <button className="linkBtn tiny" onClick={() => api.go("guests", { company: t.name })}>View guests</button>}
                  <span className="muted tiny push">Added {timeAgo(t.addedAt)}</span>
                  <button className="iconBtn sm" title="Remove from targets" onClick={() => act({ action: "unpin", key: t.key }, `${t.name} removed from targets`)}><Icon name="x" size={13} /></button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* AI suggestions */}
      <section className="stack12">
        <div className="row gap8 wrap">
          <h3 className="grow">Suggested for you</h3>
          {sug?.generatedAt && <span className="muted tiny">Updated {timeAgo(sug.generatedAt)} · {sug.provider} · from {sug.basedOn} guests and {sug.outcomesUsed} outcomes</span>}
        </div>
        {!sug ? (
          <Empty icon="building" title="No suggestions yet" action={<button className="btn btnPrimary" onClick={suggest} disabled={busy}><Icon name="sparkle" size={15} />Suggest companies</button>}>
            Get 10 companies ranked by how likely they are to have guests like your best ones, with logos, roles to search and LinkedIn links.
          </Empty>
        ) : (
          <>
            {sug.summary && <p className="focusLine">{sug.summary}</p>}
            {!sug.items.length && <p className="muted small">Everything suggested is already pinned or dismissed. Click Suggest again for more.</p>}
            <div className={`tgGrid${busy ? " dim" : ""}`}>
              {sug.items.map((c, i) => (
                <article key={c.key} className="tgCard">
                  <span className="tgRank">#{i + 1}</span>
                  <div className="tgHead">
                    <CompanyLogo name={c.name} domain={c.domain} size={42} />
                    <div className="grow">
                      <strong>{c.name}</strong>
                      <span className="muted tiny block">{c.industry}{c.size ? ` · ${c.size}` : ""}</span>
                    </div>
                    <FitBadge score={c.fitScore} />
                  </div>
                  <div className="row gap6 wrap">
                    <span className="tgChip">{c.category}</span>
                    {(c.indiaCities || []).slice(0, 3).map((x) => <span key={x} className="tgChip soft"><Icon name="globe" size={11} />{x}</span>)}
                    {c.similarTo && <span className="tgChip like">Like {c.similarTo}</span>}
                  </div>
                  <p className="small tgWhy">{c.why}</p>
                  <RoleLinks roles={c.roles} company={c.name} />
                  <div className="tgFoot">
                    <button className="btn btnSm btnPrimary" onClick={() => act({ action: "pin", company: c }, `${c.name} added to targets`)}><Icon name="plus" size={13} />Add to targets</button>
                    <button className="btn btnSm" onClick={() => act({ action: "dismiss", key: c.key }, `${c.name} hidden; future suggestions will skip it`)}>Not relevant</button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
