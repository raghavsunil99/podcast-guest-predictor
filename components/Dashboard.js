"use client";

import { useEffect, useMemo, useState } from "react";
import Icon from "./icons";
import GuestPhoto from "./GuestPhoto";
import { Avatar, CompanyLogo, Empty, ScoreRing, TierBadge, fmtDate, pct, timeAgo, useCountUp } from "./ui";
import { GuestChip } from "./Pipeline";
import { ALL_STAGES, TIERS, analytics, followUpsDue, stageClass } from "@/lib/crm";
import { nextBest } from "@/lib/learning";

function Stat({ label, value, sub, icon, accent }) {
  const v = useCountUp(value, 800);
  return (
    <div className={`stat${accent ? " statAccent" : ""}`}>
      <div className="statTop">
        <span className="statLabel">{label}</span>
        <span className="statIcon"><Icon name={icon} size={16} /></span>
      </div>
      <div className="statValue">{Math.round(v)}</div>
      {sub && <div className="statSub">{sub}</div>}
    </div>
  );
}

// Funnel: one bar per stage, width = guests who ever reached it; step conversion between bars.
function Funnel({ funnel, total }) {
  const [hover, setHover] = useState(null);
  return (
    <ol className="funnel">
      {funnel.map((f, i) => {
        const prev = i ? funnel[i - 1].n : null;
        const w = total ? Math.max(f.n ? 3 : 0, (f.n / total) * 100) : 0;
        return (
          <li key={f.stage} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className={hover === i ? "hover" : ""}>
            <span className="fLabel">{f.stage}</span>
            <div className="fTrack">
              <div className="fBar" style={{ width: `${w}%`, "--step": i }} />
              {hover === i && (
                <div className="tooltip" style={{ left: `min(${w}%, calc(100% - 180px))` }}>
                  <strong>{f.n} guests</strong> reached {f.stage}
                  <br />
                  {pct(total ? f.n / total : 0)} of everyone discovered
                </div>
              )}
            </div>
            <span className="fNum">{f.n}</span>
            <span className="fConv">{prev ? pct(f.n / prev) : ""}</span>
          </li>
        );
      })}
    </ol>
  );
}

// Company bars: total length = guests; segments = recorded / contacted (not recorded) / not contacted.
function CompanyBars({ companies, onOpen }) {
  const top = companies.slice(0, 8);
  const max = Math.max(1, ...top.map((c) => c.guests));
  const [hover, setHover] = useState(null);
  return (
    <div className="cBars">
      <div className="legend">
        <span><i className="lg lg3" />Recorded</span>
        <span><i className="lg lg2" />Contacted</span>
        <span><i className="lg lg1" />Not contacted yet</span>
      </div>
      {top.map((c) => {
        const rec = c.recorded, con = c.contacted - c.recorded, rest = c.guests - c.contacted;
        return (
          <button key={c.key} className="cBarRow" onClick={() => onOpen(c)} onMouseEnter={() => setHover(c.key)} onMouseLeave={() => setHover(null)}>
            <span className="cBarName">
              <CompanyLogo name={c.name} domain={c.domain} size={18} />
              <span className="ellipsis">{c.name}</span>
            </span>
            <span className="cBarTrack">
              <span className="cBarFill" style={{ width: `${(c.guests / max) * 100}%` }}>
                {rec > 0 && <i className="seg seg3" style={{ flex: rec }} />}
                {con > 0 && <i className="seg seg2" style={{ flex: con }} />}
                {rest > 0 && <i className="seg seg1" style={{ flex: rest }} />}
              </span>
              {hover === c.key && (
                <span className="tooltip">
                  <strong>{c.name}</strong><br />
                  {c.guests} discovered · {c.contacted} contacted · {c.recorded} recorded
                </span>
              )}
            </span>
            <span className="cBarNum">{c.guests}</span>
          </button>
        );
      })}
      {companies.length > 8 && <p className="muted tiny">+ {companies.length - 8} more companies</p>}
    </div>
  );
}

function TierSplit({ tiers, total, onPick }) {
  return (
    <div className="tierSplit">
      <div className="tierBar">
        {["High", "Medium", "Low"].map((t) =>
          tiers[t] ? <i key={t} className={`tb tb-${t}`} style={{ flex: tiers[t] }} title={`${tiers[t]} ${TIERS[t].label}`} /> : null
        )}
      </div>
      <div className="tierRows">
        {["High", "Medium", "Low"].map((t) => (
          <button key={t} onClick={() => onPick(t)}>
            <TierBadge likelihood={t} />
            <span className="push"><b>{tiers[t]}</b> <span className="muted small">{pct(total ? tiers[t] / total : 0)}</span></span>
          </button>
        ))}
        {tiers.Unscored > 0 && (
          <div className="unscored muted small">{tiers.Unscored} older guest{tiers.Unscored > 1 ? "s" : ""} without a score. Study again to score.</div>
        )}
      </div>
    </div>
  );
}

export default function Dashboard({ guests, api, settings }) {
  const a = useMemo(() => analytics(guests), [guests]);
  const due = useMemo(() => followUpsDue(guests, settings.followUpDays || 5), [guests, settings.followUpDays]);
  const best = useMemo(() => nextBest(guests, 4), [guests]);
  const recent = useMemo(
    () =>
      guests
        .flatMap((g) => (g.activity || []).slice(0, 3).map((x) => ({ ...x, g })))
        .sort((x, y) => String(y.t).localeCompare(String(x.t)))
        .slice(0, 7),
    [guests]
  );
  const conv = useCountUp(a.conversion * 100, 1000);

  if (!guests.length) {
    return (
      <Empty icon="dashboard" title="Welcome to your guest studio" action={<button className="btn btnPrimary btnLg" onClick={() => api.go("discover")}><Icon name="discover" size={17} />Study your first profile</button>}>
        Study a LinkedIn profile to predict whether they&apos;ll say yes. Your pipeline, analytics and recommendations build up from there.
      </Empty>
    );
  }
  const hero = best[0];

  return (
    <div className="dash">
      <div className="statGrid">
        <Stat label="Discovered" value={a.total} icon="discover" sub="Profiles studied" />
        <Stat label="Contacted" value={a.contacted} icon="mail" sub={`${pct(a.total ? a.contacted / a.total : 0)} of discovered`} />
        <Stat label="Responses" value={a.responded} icon="note" sub={`${pct(a.responseRate)} response rate`} />
        <Stat label="Accepted" value={a.accepted} icon="check" sub={`${pct(a.responded ? a.accepted / a.responded : 0)} of responses`} />
        <Stat label="Recorded" value={a.recorded} icon="archive" sub="Episodes done" accent />
        <Stat label="In pipeline" value={a.inPipeline} icon="pipeline" sub={`${a.rejected} rejected · ${a.notResponded} no reply`} />
      </div>

      <div className="dashGrid">
        <section className="card span2">
          <div className="cardHead">
            <div>
              <h3>Pipeline funnel</h3>
              <p className="muted small">Guests who reached each stage, with step-by-step conversion</p>
            </div>
            <div className="convPill" title="Recorded ÷ discovered">
              <span className="convNum">{conv.toFixed(conv < 10 ? 1 : 0)}%</span>
              <span className="muted tiny">discovered → recorded</span>
            </div>
          </div>
          <Funnel funnel={a.funnel} total={a.total} />
        </section>

        <section className="card nextCard">
          <div className="cardHead">
            <div>
              <h3>Next best guest</h3>
              <p className="muted small">Highest chance of a yes among guests you haven&apos;t contacted</p>
            </div>
          </div>
          {hero ? (
            <div className="nextHero">
              <button className="nextMain" onClick={() => api.open(hero.guest.id)}>
                <ScoreRing score={hero.guest.score} likelihood={hero.guest.likelihood} size={84} stroke={7} />
                <div className="nextText">
                  <div className="row gap8">
                    <GuestPhoto g={hero.guest} size={26} />
                    <strong>{hero.guest.name}</strong>
                  </div>
                  <span className="muted small">{[hero.guest.role, hero.guest.company].filter(Boolean).join(" · ")}</span>
                  {hero.why.length > 0 && <span className="why">Why: {hero.why.join("; ")}</span>}
                  {hero.guest.learning?.adjust ? <span className={`adjMini ${hero.guest.learning.adjust > 0 ? "up" : "down"}`}>{hero.guest.learning.adjust > 0 ? "+" : ""}{hero.guest.learning.adjust} learned</span> : null}
                </div>
              </button>
              {best.slice(1).map((b) => (
                <GuestChip key={b.guest.id} g={b.guest} onOpen={api.open} />
              ))}
              <button className="linkBtn" onClick={() => api.go("recommendations")}>All recommendations <Icon name="arrowRight" size={13} /></button>
            </div>
          ) : (
            <p className="muted small">Everyone has been contacted. Study more profiles to fill the top of the funnel.</p>
          )}
        </section>

        <section className="card span2">
          <div className="cardHead">
            <div>
              <h3>Guests by company</h3>
              <p className="muted small">Discovered, contacted and recorded per company</p>
            </div>
            <button className="linkBtn" onClick={() => api.go("companies")}>All companies <Icon name="arrowRight" size={13} /></button>
          </div>
          {a.companies.length ? <CompanyBars companies={a.companies} onOpen={() => api.go("companies")} /> : <p className="muted small">No company data yet.</p>}
        </section>

        <section className="card">
          <div className="cardHead">
            <div>
              <h3>Follow-ups due</h3>
              <p className="muted small">Contacted, no reply for {settings.followUpDays || 5}+ days</p>
            </div>
            {due.length > 0 && <span className="countBadge">{due.length}</span>}
          </div>
          {due.length ? (
            <ul className="dueList">
              {due.slice(0, 5).map(({ guest: g, reason }) => (
                <li key={g.id}>
                  <GuestChip g={g} onOpen={api.open} showRing={false} extra={<span className="dueTag"><Icon name="bell" size={11} />{reason}</span>} />
                  <button className="iconBtn sm" title="Mark follow-up sent" onClick={() => api.patch(g.id, { followedUp: true })}>
                    <Icon name="check" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="allClear"><Icon name="check" size={16} />You&apos;re all caught up.</div>
          )}
        </section>

        <TopTargets api={api} />

        <section className="card">
          <div className="cardHead"><div><h3>Outcomes</h3><p className="muted small">Where every guest is right now</p></div></div>
          <ul className="outcomeList">
            {ALL_STAGES.map((st) => (
              <li key={st}>
                <button onClick={() => api.go("guests", { stage: st })}>
                  <span className={`stage ${stageClass(st)}`}>{st}</span>
                  <b className="push">{a.byStage[st]}</b>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <div className="cardHead"><div><h3>Guest potential</h3><p className="muted small">Prediction score spread</p></div></div>
          <TierSplit tiers={a.tiers} total={a.total} onPick={(t) => api.go("guests", { tier: t })} />
        </section>

        <section className="card">
          <div className="cardHead"><div><h3>Recent activity</h3></div></div>
          <ul className="feed">
            {recent.map((r) => (
              <li key={r.id + r.g.id}>
                <GuestPhoto g={r.g} size={28} />
                <p>
                  <button className="linkBtn strong" onClick={() => api.open(r.g.id)}>{r.g.name}</button>{" "}
                  <span className="muted">{r.type === "note" ? `· note: ${r.text}` : `· ${r.text}`}</span>
                </p>
                <span className="muted tiny push" title={fmtDate(r.t)}>{timeAgo(r.t)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

// Pinned target companies, with how many guests you've found at each.
function TopTargets({ api }) {
  const [t, setT] = useState(null);
  useEffect(() => { fetch("/api/targets", { cache: "no-store" }).then((r) => r.json()).then(setT).catch(() => setT({ pinned: [] })); }, []);
  const pinned = (t?.pinned || []).filter((x) => x.status !== "Recorded").slice(0, 5);
  const ideas = (t?.suggestions?.items || []).slice(0, 3);
  return (
    <section className="card">
      <div className="cardHead">
        <div><h3>Target companies</h3><p className="muted small">Where to find your next guests</p></div>
        <button className="linkBtn" onClick={() => api.go("targets")}>Open <Icon name="arrowRight" size={13} /></button>
      </div>
      {!t ? <p className="muted small">Loading…</p> : pinned.length ? (
        <ul className="ttList">
          {pinned.map((x) => (
            <li key={x.key}>
              <CompanyLogo name={x.name} domain={x.domain} size={26} />
              <span className="grow"><strong>{x.name}</strong><span className="muted tiny block">{x.status} · {x.progress.found} studied{x.progress.recorded ? ` · ${x.progress.recorded} recorded` : ""}</span></span>
              {x.fitScore != null && <span className="ttFit">{x.fitScore}</span>}
            </li>
          ))}
        </ul>
      ) : ideas.length ? (
        <>
          <p className="muted tiny">Top AI suggestions (not pinned yet):</p>
          <ul className="ttList">
            {ideas.map((x) => (
              <li key={x.key}>
                <CompanyLogo name={x.name} domain={x.domain} size={26} />
                <span className="grow"><strong>{x.name}</strong><span className="muted tiny block">{x.industry}</span></span>
                <span className="ttFit">{x.fitScore}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <button className="btn btnSm" onClick={() => api.go("targets")}><Icon name="sparkle" size={14} />Get AI company suggestions</button>
      )}
    </section>
  );
}
