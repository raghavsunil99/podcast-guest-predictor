"use client";

// Views of a single generation result: prediction, background, and the editable messages.
import { useState } from "react";
import Icon from "./icons";
import { CompanyLogo, ScoreRing, TierBadge, fmt, useCopy } from "./ui";
import { analyzeCareer, fmtMonths } from "@/lib/career";
import { tierOf } from "@/lib/crm";

const VERDICT = { High: "Likely to say yes", Medium: "Worth a try", Low: "Long shot" };

// Explains how past outcomes moved this guest's score.
function LearnedPanel({ learning, onOpenGuest }) {
  if (!learning) return null;
  if (!learning.active) {
    return (
      <div className="learned learnedIdle">
        <Icon name="brain" size={16} />
        <p>{learning.note || "Learning from outcomes will adjust this score once you have a few accepted or rejected guests."}</p>
      </div>
    );
  }
  const a = learning.adjust;
  return (
    <div className="learned">
      <div className="learnedHead">
        <span className="eyebrow"><Icon name="brain" size={13} /> Learned from your outcomes</span>
        <span className={`adjPill ${a > 0 ? "up" : a < 0 ? "down" : ""}`}>
          AI {learning.base} {a >= 0 ? "+" : "−"} {Math.abs(a)} = <b>{Math.max(0, Math.min(100, learning.base + a))}</b>
        </span>
      </div>
      <div className="twoQ">
        <div>
          <span className="muted tiny">Chance they reply</span>
          <b>{learning.replyChance != null ? `~${learning.replyChance}%` : "—"}</b>
          <span className="muted tiny">{learning.basis ? `${learning.basis.replied} replied · ${learning.basis.silent} stayed silent` : ""}</span>
        </div>
        <div>
          <span className="muted tiny">Chance of yes if they reply</span>
          <b>{learning.yesIfReply != null ? `~${learning.yesIfReply}%` : "—"}</b>
          <span className="muted tiny">
            {learning.basis ? (learning.basis.saidNo ? `${learning.basis.saidYes} said yes · ${learning.basis.saidNo} said no` : `No one has said no yet, so this can't be learned`) : ""}
          </span>
        </div>
      </div>
      {learning.reasons.length > 0 ? (
        <ul className="learnedReasons">
          {learning.reasons.map((r, i) => (
            <li key={i} className={r.dir}>
              <Icon name={r.dir === "up" ? "arrowUp" : "arrowDown"} size={13} />
              <span className={`qTag q-${r.q}`}>{r.q === "reply" ? "Reply" : "Yes"}</span>
              {r.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No strong pattern from past outcomes matches this profile yet.</p>
      )}
      {learning.neighbours.length > 0 && (
        <div className="neighbours">
          <span className="muted tiny">Most similar past guests</span>
          {learning.neighbours.map((n) => (
            <button key={n.id} className={`nbr ${n.yes ? "yes" : "no"}`} onClick={() => onOpenGuest?.(n.id)}>
              {n.name} · {n.outcome} · {n.similarity}% similar
            </button>
          ))}
        </div>
      )}
      <p className="muted tiny">
        Based on {learning.learnedFrom} guest outcome{learning.learnedFrom === 1 ? "" : "s"}. Learns separately from silence (no reply) and from a no after replying. Contacted guests with no reply for a week start counting as silence. Adjustments are capped at ±15 and get stronger as more no's are recorded. Native language and region are not used.
      </p>
    </div>
  );
}

const isUnknown = (v) => !v || v === "Unknown" || v === "None found";

function SignalsEditor({ ss, onSave, onCancel }) {
  const [v, setV] = useState({
    followers: isUnknown(ss.followers) ? "" : ss.followers,
    connections: isUnknown(ss.connections) ? "" : ss.connections,
    postingActivity: ss.postingActivity === "Unknown" ? "" : ss.postingActivity,
    publicSpeaking: ss.publicSpeaking || "",
  });
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="signalsEdit"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const out = {};
        if (v.followers !== (isUnknown(ss.followers) ? "" : ss.followers)) out.followers = v.followers;
        if (v.connections !== (isUnknown(ss.connections) ? "" : ss.connections)) out.connections = v.connections;
        if (v.postingActivity && v.postingActivity !== ss.postingActivity) out.postingActivity = v.postingActivity;
        if (v.publicSpeaking && v.publicSpeaking !== ss.publicSpeaking) out.publicSpeaking = v.publicSpeaking;
        await onSave(out);
        setBusy(false);
      }}
    >
      <p className="muted small">Open their LinkedIn profile and fill in what you see. The score is recalculated from your numbers.</p>
      <div className="formGrid four">
        <label className="field"><span>Followers</span><input value={v.followers} onChange={(e) => setV({ ...v, followers: e.target.value })} placeholder="e.g. 4,200" /></label>
        <label className="field"><span>Connections</span><input value={v.connections} onChange={(e) => setV({ ...v, connections: e.target.value })} placeholder="e.g. 500+" /></label>
        <label className="field">
          <span>Posts on LinkedIn</span>
          <select value={v.postingActivity} onChange={(e) => setV({ ...v, postingActivity: e.target.value })}>
            <option value="">Not sure</option><option>Frequent</option><option>Occasional</option><option>Rare</option>
          </select>
        </label>
        <label className="field">
          <span>Public speaking</span>
          <select value={v.publicSpeaking} onChange={(e) => setV({ ...v, publicSpeaking: e.target.value })}>
            <option value="">Not sure</option><option>Strong</option><option>Some</option><option value="None found">None</option>
          </select>
        </label>
      </div>
      <div className="row gap8">
        <button className="btn btnPrimary btnSm" disabled={busy}>{busy ? <span className="btnSpinner" /> : <Icon name="check" size={14} />}Save &amp; rescore</button>
        <button type="button" className="btn btnSm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function SignalCell({ label, value, manual, onEdit }) {
  const unknown = isUnknown(value);
  return (
    <div className={`sigCell${unknown ? " sigUnknown" : ""}`}>
      <dt>{label}{manual && <span className="srcTag src-manual">You</span>}</dt>
      <dd>
        {unknown ? (
          onEdit ? <button type="button" className="linkBtn" onClick={onEdit}>Not in profile · Add</button> : <span className="muted">Not in profile</span>
        ) : value}
      </dd>
    </div>
  );
}

export function PredictionPanel({ acc, ss, learning, onOpenGuest, onSaveSignals }) {
  const [editing, setEditing] = useState(false);
  if (!acc) return null;
  const finalScore = learning?.active ? Math.max(0, Math.min(100, learning.base + learning.adjust)) : acc.score;
  const tier = tierOf({ score: finalScore });
  const criteria = acc.criteria;
  return (
    <section className={`predict predict-${tier}`} aria-label="Guest prediction">
      <div className="predictTop">
        <ScoreRing score={finalScore} size={124} stroke={10} />
        <div className="predictVerdict">
          <div className="eyebrow">Acceptance prediction</div>
          <h3 className="verdictTitle">{VERDICT[tier]}</h3>
          <TierBadge score={finalScore} />
          {acc.summary && <p className="predictSummary">{acc.summary}</p>}
          {criteria && (
            <p className={`coverage${acc.dataCoverage < 3 ? " coverageLow" : ""}`}>
              <Icon name="target" size={14} /> {acc.dataCoverage} of {criteria.length} signals found in the profile
              {acc.dataCoverage < 3 && (onSaveSignals ? " · add their followers and activity below for a sharper score" : " · paste their follower count and Activity section for a sharper score")}
            </p>
          )}
        </div>
      </div>

      <LearnedPanel learning={learning} onOpenGuest={onOpenGuest} />

      {ss && !editing && (
        <div className="signalsWrap">
          <dl className="signals">
            <SignalCell label="Followers" value={ss.followers} manual={ss.manual?.followers} onEdit={onSaveSignals && (() => setEditing(true))} />
            <SignalCell label="Connections" value={ss.connections} manual={ss.manual?.connections} onEdit={onSaveSignals && (() => setEditing(true))} />
            <SignalCell label="Posting" value={ss.postingActivity} manual={ss.manual?.postingActivity} onEdit={onSaveSignals && (() => setEditing(true))} />
            <SignalCell label="Speaking" value={ss.publicSpeaking} manual={ss.manual?.publicSpeaking} onEdit={onSaveSignals && (() => setEditing(true))} />
          </dl>
          {onSaveSignals && (
            <button type="button" className="iconBtn sm sigEditBtn" title="Edit LinkedIn signals" onClick={() => setEditing(true)}><Icon name="edit" size={13} /></button>
          )}
        </div>
      )}
      {ss && editing && <SignalsEditor ss={ss} onCancel={() => setEditing(false)} onSave={async (sig) => { if (Object.keys(sig).length) await onSaveSignals(sig); setEditing(false); }} />}

      {criteria ? (
        <div className="criteria">
          <div className="criteriaHead">
            <span className="eyebrow">How the AI profile score is built</span>
            <span className="eyebrow">Points</span>
          </div>
          <ol className="critList">
            {criteria.map((c, i) => {
              const level = c.score >= 7 ? "good" : c.score >= 4 ? "mid" : "poor";
              return (
                <li key={c.id} className={c.found ? "" : "missing"} style={{ "--i": i }}>
                  <div className="critRow">
                    <div className="critName">
                      <strong>{c.label}</strong>
                      <span className="weight">{c.weight}%</span>
                      {!c.found && <span className="noData">Not in profile</span>}
                    </div>
                    <span className="critPts">{c.points}<small>/{c.weight}</small></span>
                  </div>
                  <div className="critBar" aria-hidden>
                    <div className={`critFill ${level}`} style={{ width: `${c.score * 10}%` }} />
                  </div>
                  <p className="critEvidence">{c.evidence}</p>
                </li>
              );
            })}
          </ol>
          <p className="formula">
            Each signal is rated 0–10 from the profile and multiplied by its weight. Missing signals count as 5/10.
            65+ is high potential, 45–64 medium, under 45 low.
          </p>
        </div>
      ) : (
        acc.factors?.length > 0 && (
          <ul className="legacyFactors">
            {acc.factors.map((f, i) => <li key={i}><strong>{f.factor}</strong> {f.detail}</li>)}
          </ul>
        )
      )}

      {acc.tips?.length > 0 && (
        <div className="tipsBox">
          <div className="eyebrow">How to get a yes</div>
          <ul>{acc.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

export function BackgroundPanel({ result }) {
  const p = result?.profile || {};
  const bg = result?.background || {};
  const known = (v) => v && v !== "Unknown";
  return (
    <div className="bgGrid">
      <div className="panel">
        <div className="eyebrow">Education</div>
        {p.education?.length ? (
          <ul className="eduList">
            {p.education.map((e, i) => (
              <li key={i} className="eduItem">
                <CompanyLogo name={e.institution} domain={e.domain} size={30} />
                <div className="eduText">
                  <strong>{e.institution}</strong>
                  {(e.degree || e.field) && <span className="small">{[e.degree, e.field].filter(Boolean).join(", ")}</span>}
                  <span className="muted small">{[e.years, e.place].filter(Boolean).join(" · ")}</span>
                  {e.type && !["Other", "School"].includes(e.type) && <span className="eduType" title="Estimated from the institution name">{e.type}</span>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Not listed on the profile</p>
        )}
      </div>
      <div className="panel">
        <div className="eyebrow">Regional background</div>
        <p className="lang">
          {bg.nativeLanguage || "Unknown"}
          {bg.confidence && <span className={`conf conf-${bg.confidence}`}>{bg.confidence} confidence</span>}
        </p>
        {known(bg.nativeRegion) && <p className="muted small">Likely from {bg.nativeRegion}</p>}
        {bg.nativeGreeting && <p className="small">Greeting: <strong>{bg.nativeGreeting}</strong></p>}
        <p className="small">Addressed as <strong>{result.honorific ? `${p.firstName} ${result.honorific}` : p.firstName}</strong></p>
        {bg.signals?.length > 0 && (
          <details className="miniDetails">
            <summary>How this was guessed</summary>
            <ul>{bg.signals.map((s, i) => <li key={i}>{s}</li>)}</ul>
            <p className="muted small">A guess from name and education. It only picks the greeting and is never mentioned in messages.</p>
          </details>
        )}
      </div>
    </div>
  );
}

const TABS = [
  { id: "fullMessage", label: "Invitation", hint: "LinkedIn InMail or email" },
  { id: "connectionNote", label: "Connection note", hint: "LinkedIn, 300 characters max", limit: 300 },
  { id: "whatsappMessage", label: "WhatsApp", hint: "Short and warm" },
  { id: "followUpMessage", label: "Follow-up", hint: "If there's no reply in a few days" },
];

export function MessagesPanel({ result, onEdit, linkedinUrl, onCopied }) {
  const [tab, setTab] = useState("fullMessage");
  const [copied, copy] = useCopy();
  const current = result?.[tab] || "";
  const info = TABS.find((t) => t.id === tab);
  const words = current.trim() ? current.trim().split(/\s+/).length : 0;
  return (
    <div className="messages">
      <div className="msgTabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="msgMeta">
        <span>{info.hint}</span>
        <span className={info.limit && current.length > info.limit ? "over" : ""}>
          {current.length}{info.limit ? ` / ${info.limit}` : ""} chars · {words} words
        </span>
      </div>
      <textarea className="message" value={current} onChange={(e) => onEdit(tab, e.target.value)} rows={tab === "fullMessage" ? 16 : 7} />
      <div className="row gap8 wrap">
        <button
          className="btn btnPrimary"
          onClick={async () => {
            if (await copy(current, tab)) onCopied?.(info.label);
          }}
        >
          <Icon name={copied === tab ? "check" : "copy"} size={16} />
          {copied === tab ? "Copied" : `Copy ${info.label.toLowerCase()}`}
        </button>
        {linkedinUrl && (
          <a className="btn" href={linkedinUrl} target="_blank" rel="noreferrer">
            <Icon name="linkedin" size={16} /> Open profile
          </a>
        )}
        {result?.tokensUsed > 0 && <span className="muted small push">{fmt(result.tokensUsed)} tokens · {result.ai?.provider ? `${result.ai.provider} · ` : ""}{result.model}</span>}
      </div>
      {result?.personalizationNotes?.length > 0 && (
        <details className="miniDetails">
          <summary>What was personalized</summary>
          <ul>{result.personalizationNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          {result.honorificReason && <p className="muted small">Honorific: {result.honorificReason}</p>}
        </details>
      )}
    </div>
  );
}

const range = (r) => [r.start, r.end].filter(Boolean).join(" – ").replace(/(\d{4})-(\d{2})/g, (_, y, m) => `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(m) - 1] || ""} ${y}`);

export function CareerTimeline({ profile }) {
  const c = analyzeCareer(profile?.experience);
  if (!c.jobs.length) return null;
  return (
    <div className="panel career">
      <div className="careerHead">
        <span className="eyebrow">Career journey</span>
        <div className="careerStats">
          {c.totalMonths != null && <span><b>{fmtMonths(c.totalMonths, c.approx)}</b> experience</span>}
          <span><b>{c.companies}</b> compan{c.companies === 1 ? "y" : "ies"}</span>
          {c.avgTenureMonths != null && c.companies > 1 && <span><b>{fmtMonths(c.avgTenureMonths, c.approx)}</b> avg per company</span>}
          {c.promotions > 0 && <span><b>{c.promotions}</b> promotion{c.promotions > 1 ? "s" : ""}</span>}
        </div>
      </div>
      {(c.tags.length > 0 || profile.careerSwitch) && (
        <div className="moveTags">
          {profile.careerSwitch && <span className="moveTag switch">Career switch: {profile.careerSwitch}</span>}
          {c.moves.map((m, i) => <span key={i} className="moveTag" title={m.type}>{m.type}: {m.text}</span>)}
          {c.tags.filter((t) => t.startsWith("Promoted") || t === "Long tenure").map((t) => <span key={t} className="moveTag neutral">{t}</span>)}
        </div>
      )}
      <ol className="jobs">
        {c.jobs.map((j, i) => (
          <li key={i} className={`job${j.current ? " current" : ""}${j.intern ? " intern" : ""}`}>
            <CompanyLogo name={j.company} domain={j.companyDomain} size={34} />
            <div className="jobBody">
              <div className="jobHead">
                <strong>{j.company}</strong>
                {j.months != null && <span className="jobDur">{fmtMonths(j.months, j.approx)}</span>}
                {j.current && <span className="nowTag">Current</span>}
                {j.service && <span className="kindTag">Services</span>}
                {j.bigTech && <span className="kindTag big">Big Tech</span>}
                {j.intern && <span className="kindTag">Internship</span>}
              </div>
              {j.location && <span className="muted tiny">{j.location}</span>}
              <ol className={`roles${j.roles.length > 1 ? " multi" : ""}`}>
                {j.roles.map((r, k) => (
                  <li key={k}>
                    <span className="roleTitle">{r.title}</span>
                    <span className="muted tiny">{range(r)}{r.months != null ? ` · ${fmtMonths(r.months, r.approx)}` : ""}</span>
                  </li>
                ))}
              </ol>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ProfileSummary({ result }) {
  const p = result?.profile || {};
  const structured = p.experience?.length > 0;
  if (!p.aboutSummary && !p.careerPath?.length && !structured) return null;
  return (
    <div className="panel">
      <div className="eyebrow">About</div>
      {p.aboutSummary && <p className="small">{p.aboutSummary}</p>}
      {!structured && p.careerPath?.length > 0 && (
        <ol className="timeline">{p.careerPath.map((c, i) => <li key={i}>{c}</li>)}</ol>
      )}
      {p.skills?.length > 0 && <div className="chips">{p.skills.map((s, i) => <span key={i}>{s}</span>)}</div>}
    </div>
  );
}
