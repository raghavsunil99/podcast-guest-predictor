"use client";

// Views of a single generation result: prediction, background, and the editable messages.
import { useState } from "react";
import Icon from "./icons";
import { ScoreRing, TierBadge, fmt, useCopy } from "./ui";
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
      {learning.reasons.length > 0 ? (
        <ul className="learnedReasons">
          {learning.reasons.map((r, i) => (
            <li key={i} className={r.dir}>
              <Icon name={r.dir === "up" ? "arrowUp" : "arrowDown"} size={13} />
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
        Based on {learning.learnedFrom} guest outcome{learning.learnedFrom === 1 ? "" : "s"}. Adjustments are capped at ±15 and grow as more outcomes are recorded. Native language and region are not used.
      </p>
    </div>
  );
}

export function PredictionPanel({ acc, ss, learning, onOpenGuest }) {
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
              {acc.dataCoverage < 3 && " · paste their follower count and Activity section for a sharper score"}
            </p>
          )}
        </div>
      </div>

      <LearnedPanel learning={learning} onOpenGuest={onOpenGuest} />

      {ss && (
        <dl className="signals">
          <div><dt>Followers</dt><dd>{ss.followers}</dd></div>
          <div><dt>Connections</dt><dd>{ss.connections}</dd></div>
          <div><dt>Posting</dt><dd>{ss.postingActivity}</dd></div>
          <div><dt>Speaking</dt><dd>{ss.publicSpeaking}</dd></div>
        </dl>
      )}

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
              <li key={i}>
                <strong>{e.institution}</strong>
                {e.place && <span className="muted"> · {e.place}</span>}
                {(e.degree || e.years) && <div className="muted small">{[e.degree, e.years].filter(Boolean).join(" · ")}</div>}
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

export function ProfileSummary({ result }) {
  const p = result?.profile || {};
  if (!p.aboutSummary && !p.careerPath?.length) return null;
  return (
    <div className="panel">
      <div className="eyebrow">Career</div>
      {p.aboutSummary && <p className="small">{p.aboutSummary}</p>}
      {p.careerPath?.length > 0 && (
        <ol className="timeline">{p.careerPath.map((c, i) => <li key={i}>{c}</li>)}</ol>
      )}
      {p.skills?.length > 0 && <div className="chips">{p.skills.map((s, i) => <span key={i}>{s}</span>)}</div>}
    </div>
  );
}
