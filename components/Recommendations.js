"use client";

import { useEffect, useMemo, useState } from "react";
import Icon from "./icons";
import GuestPhoto from "./GuestPhoto";
import { Avatar, CompanyLogo, Empty, ScoreRing, timeAgo } from "./ui";
import { GuestChip } from "./Pipeline";
import { groupCompanies } from "@/lib/crm";
import { nextBest, similarProfiles, successProfile } from "@/lib/learning";

const liSearch = (kw) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(kw)}`;

function Feedback({ value, onChange, small }) {
  return (
    <span className={`fb${small ? " fbSmall" : ""}`}>
      <button className={value === "relevant" ? "on good" : ""} title="Relevant" aria-label="Mark relevant" onClick={(e) => { e.stopPropagation(); onChange(value === "relevant" ? null : "relevant"); }}>
        <Icon name="thumbUp" size={13} />
      </button>
      <button className={value === "irrelevant" ? "on bad" : ""} title="Not relevant" aria-label="Mark not relevant" onClick={(e) => { e.stopPropagation(); onChange(value === "irrelevant" ? null : "irrelevant"); }}>
        <Icon name="thumbDown" size={13} />
      </button>
    </span>
  );
}

export default function Recommendations({ guests, api, settings, model, onUsageChange, flash }) {
  const best = useMemo(() => nextBest(guests, 6), [guests]);
  const similar = useMemo(() => similarProfiles(guests, 6), [guests]);
  const profile = useMemo(() => successProfile(model), [model]);
  const dense = useMemo(
    () => groupCompanies(guests).filter((c) => c.guests >= 2 && c.open > 0).sort((a, b) => b.open * (b.avgScore || 50) - a.open * (a.avgScore || 50)).slice(0, 4),
    [guests]
  );
  const [ai, setAi] = useState(null);
  const [feedback, setFeedback] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/recommend", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setFeedback(d.feedback || {});
        if (!d.empty) setAi(d);
      })
      .catch(() => {});
  }, []);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/recommend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings }) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || "Couldn't get recommendations.");
      setAi(d);
      if (d.notice) flash?.(d.notice);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      onUsageChange?.();
    }
  }

  async function rate(kind, key, value) {
    setFeedback((f) => ({ ...f, [`${kind}:${key}`]: value || undefined }));
    const r = await fetch("/api/recommend/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, key, value }) });
    if (r.ok) setFeedback((await r.json()).feedback);
  }
  const fbOf = (kind, key) => feedback[`${kind}:${key}`] || null;
  const rateGuest = (g, v) => api.patch(g.id, { patch: { recFeedback: v || "" } });

  const hero = best[0];
  const o = profile.outcomes;

  return (
    <div className="recs">
      <section className="recHero card">
        <div className="recHeroText">
          <span className="eyebrow accent">Next best guest to approach</span>
          {hero ? (
            <>
              <button className="recHeroGuest" onClick={() => api.open(hero.guest.id)}>
                <GuestPhoto g={hero.guest} size={52} ring />
                <span>
                  <strong>{hero.guest.name}</strong>
                  <span className="muted">{[hero.guest.role, hero.guest.company].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
              <ul className="reasons">
                {(hero.why.length ? hero.why : ["highest score among guests not yet contacted"]).map((w, i) => (
                  <li key={i}><Icon name="check" size={14} />{w.charAt(0).toUpperCase() + w.slice(1)}</li>
                ))}
              </ul>
              <div className="row gap8 wrap">
                <button className="btn btnPrimary" onClick={() => api.open(hero.guest.id)}>View invite <Icon name="arrowRight" size={14} /></button>
                {hero.guest.stage === "Discovered" && <button className="btn" onClick={() => api.patch(hero.guest.id, { stage: "Shortlisted" })}>Shortlist</button>}
                <span className="muted tiny">Good suggestion?</span>
                <Feedback value={hero.guest.recFeedback} onChange={(v) => rateGuest(hero.guest, v)} />
              </div>
            </>
          ) : (
            <p className="muted">No uncontacted guests left. Study more profiles, or use the ideas below to find them.</p>
          )}
        </div>
        {hero && <ScoreRing score={hero.guest.score} likelihood={hero.guest.likelihood} size={140} stroke={11} />}
      </section>

      <section className="card learnCard">
        <div className="cardHead">
          <div>
            <h3><Icon name="brain" size={16} /> What your successful guests have in common</h3>
            <p className="muted small">
              Learned from {o.yes} accepted or recorded and {o.no} rejected or unanswered guest{o.yes + o.no === 1 ? "" : "s"}
              {o.feedback ? `, plus ${o.feedback} relevance rating${o.feedback === 1 ? "" : "s"}` : ""}. Scores across the app include this learning.
            </p>
          </div>
        </div>
        {o.yes === 0 ? (
          <p className="muted small">Move guests to <b>Accepted</b> or <b>Recorded</b> (and <b>Rejected</b> or <b>Not responded</b> when that happens). The app then learns which profile traits lead to a yes and adjusts every score.</p>
        ) : (
          <div className="traitGrid">
            <div>
              <span className="eyebrow">Signals of a yes</span>
              <ul className="traitList">
                {profile.traits.map((t, i) => (
                  <li key={i}>
                    <span className="traitName">{t.trait}</span>
                    <strong>{t.value}</strong>
                    <span className="push muted tiny">{t.yes}/{t.total} yes</span>
                  </li>
                ))}
                {!profile.traits.length && <li className="muted small">No clear pattern yet.</li>}
              </ul>
            </div>
            <div>
              <span className="eyebrow">Seen only in no’s so far</span>
              <ul className="traitList neg">
                {profile.warnings.map((t, i) => (
                  <li key={i}>
                    <span className="traitName">{t.trait}</span>
                    <strong>{t.value}</strong>
                    <span className="push muted tiny">{t.no} no</span>
                  </li>
                ))}
                {!profile.warnings.length && <li className="muted small">No rejections recorded yet.</li>}
              </ul>
            </div>
          </div>
        )}
      </section>

      <div className="recGrid">
        <section className="card">
          <div className="cardHead"><div><h3>Up next</h3><p className="muted small">Ranked by learned score and your shortlist</p></div></div>
          {best.length > 1 ? (
            <div className="stack6">
              {best.slice(1).map((b) => (
                <div key={b.guest.id} className="recRow">
                  <GuestChip g={b.guest} onOpen={api.open} extra={b.why[0] && <span className="why tiny">{b.why[0]}</span>} />
                  <Feedback small value={b.guest.recFeedback} onChange={(v) => rateGuest(b.guest, v)} />
                </div>
              ))}
            </div>
          ) : <p className="muted small">Nothing else waiting.</p>}
        </section>

        <section className="card">
          <div className="cardHead"><div><h3>Similar to guests who said yes</h3><p className="muted small">Matched on role, seniority, experience, industry and expertise, preferring other companies</p></div></div>
          {similar.length ? (
            <div className="stack6">
              {similar.map((s) => (
                <div key={s.guest.id} className="recRow">
                  <GuestChip
                    g={s.guest}
                    onOpen={api.open}
                    extra={<span className="why tiny">{Math.round(s.sim * 100)}% like {s.seed.name}{s.reasons.length ? `: ${s.reasons.join(", ")}` : ""}</span>}
                  />
                  <Feedback small value={s.guest.recFeedback} onChange={(v) => rateGuest(s.guest, v)} />
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">Appears once guests have accepted or recorded. Their profiles become the template for who to approach next.</p>
          )}
        </section>

        <section className="card">
          <div className="cardHead"><div><h3>Untapped companies in your list</h3><p className="muted small">Several guests found, some not contacted yet</p></div></div>
          {dense.length ? (
            <ul className="coList">
              {dense.map((c) => (
                <li key={c.key}>
                  <CompanyLogo name={c.name} domain={c.domain} size={30} />
                  <span className="grow"><strong>{c.name}</strong><span className="muted small">{c.open} of {c.guests} not contacted · avg score {c.avgScore ?? "–"}</span></span>
                  <button className="btn btnSm" onClick={() => api.go("guests", { company: c.name })}>View</button>
                </li>
              ))}
            </ul>
          ) : <p className="muted small">Appears when you have 2+ guests from the same company.</p>}
        </section>
      </div>

      <section className="aiBlock">
        <div className="aiHead">
          <div>
            <h3><Icon name="sparkle" size={18} /> Where to find more guests like your yeses</h3>
            <p className="muted small">
              AI ideas from your accepted and rejected guests, guest criteria and your 👍/👎 ratings.
              {ai?.generatedAt && ` Updated ${timeAgo(ai.generatedAt)} from ${ai.basedOn} guests${ai.outcomesUsed != null ? ` and ${ai.outcomesUsed} outcomes` : ""}${ai.provider ? ` by ${ai.provider}` : ""}.`}
            </p>
          </div>
          <button className="btn btnPrimary" onClick={refresh} disabled={loading}>
            {loading ? <span className="btnSpinner" aria-hidden /> : <Icon name="refresh" size={15} />}
            {loading ? "Thinking…" : ai ? "Refresh ideas" : "Get ideas"}
          </button>
        </div>
        {error && <div className="alert alertError">{error}</div>}
        {!ai && !loading && !error && (
          <div className="card aiEmpty">
            <p className="muted">Get companies you haven&apos;t explored, companies with many relevant professionals, and profile types to search for. Uses one AI request.</p>
          </div>
        )}
        {ai && (
          <div className={`stack16${loading ? " dim" : ""}`}>
            {ai.focus && <p className="focusLine">{ai.focus}</p>}

            <div>
              <h4 className="subHead">Companies you haven&apos;t explored</h4>
              <div className="ideaGrid">
                {(ai.companiesToExplore || []).map((c) => (
                  <article key={c.name} className={`idea${fbOf("company", c.name) === "irrelevant" ? " dismissed" : ""}`}>
                    <div className="row gap10">
                      <CompanyLogo name={c.name} domain={c.domain} size={34} />
                      <span className="grow"><strong>{c.name}</strong><span className="muted tiny block">{c.industry}</span></span>
                      <Feedback small value={fbOf("company", c.name)} onChange={(v) => rate("company", c.name, v)} />
                    </div>
                    <p className="small">{c.why}</p>
                    <div className="roleLinks">
                      {(c.rolesToLookFor || []).map((r) => (
                        <a key={r} href={liSearch(`${r} ${c.name}`)} target="_blank" rel="noreferrer">{r}<Icon name="external" size={11} /></a>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="twoCol">
              <div>
                <h4 className="subHead">High concentration of relevant professionals</h4>
                <ul className="coList">
                  {(ai.highConcentration || []).map((c) => (
                    <li key={c.name} className={fbOf("company", c.name) === "irrelevant" ? "dismissed" : ""}>
                      <CompanyLogo name={c.name} domain={c.domain} size={30} />
                      <span className="grow"><strong>{c.name}</strong><span className="muted small">{c.why}</span></span>
                      <Feedback small value={fbOf("company", c.name)} onChange={(v) => rate("company", c.name, v)} />
                      <a className="btn btnSm" href={liSearch(c.name)} target="_blank" rel="noreferrer">Search <Icon name="external" size={11} /></a>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="subHead">Profiles to look for</h4>
                <ul className="profileIdeas">
                  {(ai.profileIdeas || []).map((p) => (
                    <li key={p.title} className={fbOf("profile", p.title) === "irrelevant" ? "dismissed" : ""}>
                      <div className="grow">
                        <strong>{p.title}</strong>
                        <span className="muted small">{p.why}</span>
                      </div>
                      <Feedback small value={fbOf("profile", p.title)} onChange={(v) => rate("profile", p.title, v)} />
                      <a className="btn btnSm" href={liSearch(p.searchKeywords)} target="_blank" rel="noreferrer"><Icon name="search" size={13} />LinkedIn</a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </section>

      {!guests.length && <Empty icon="compass" title="Recommendations improve as you go">Study a few profiles and record who accepts. Suggestions learn from what works.</Empty>}
    </div>
  );
}
