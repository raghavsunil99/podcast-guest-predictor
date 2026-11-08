"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_SETTINGS, STATUSES } from "@/lib/defaults";

const SETTINGS_KEY = "epi.settings.v1";
const HISTORY_KEY = "epi.history.v1";

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const TABS = [
  { id: "fullMessage", label: "Full message", hint: "LinkedIn InMail / email" },
  { id: "connectionNote", label: "Connection note", hint: "LinkedIn, max 300 characters", limit: 300 },
  { id: "whatsappMessage", label: "WhatsApp", hint: "Short and casual" },
  { id: "followUpMessage", label: "Follow-up", hint: "Send if no reply after 4–5 days" },
];

export default function Home() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [history, setHistory] = useState([]);
  const [url, setUrl] = useState("");
  const [profileText, setProfileText] = useState("");
  const [pdf, setPdf] = useState(null);
  const [honorific, setHonorific] = useState("auto");
  const [extra, setExtra] = useState("");
  const [nativeGreeting, setNativeGreeting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [tab, setTab] = useState("fullMessage");
  const [copied, setCopied] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [usage, setUsage] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    setSettings({ ...DEFAULT_SETTINGS, ...load(SETTINGS_KEY, {}) });
    setHistory(load(HISTORY_KEY, []));
  }, []);

  async function refreshUsage() {
    try {
      const r = await fetch("/api/usage", { cache: "no-store" });
      if (r.ok) setUsage(await r.json());
    } catch {}
  }
  useEffect(() => {
    refreshUsage();
  }, []);

  function updateHistory(next) {
    setHistory(next);
    save(HISTORY_KEY, next);
  }

  async function generate(e) {
    e?.preventDefault();
    setError("");
    if (!url.trim() && !profileText.trim() && !pdf) {
      setError("Add a LinkedIn URL, paste the profile text, or upload the profile PDF.");
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("url", url.trim());
      fd.append("profileText", profileText);
      fd.append("honorific", honorific);
      fd.append("extraInstructions", extra);
      fd.append("nativeGreeting", nativeGreeting ? "yes" : "no");
      fd.append("settings", JSON.stringify(settings));
      if (pdf) fd.append("pdf", pdf);
      const res = await fetch("/api/generate", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({ error: "Unexpected server response." }));
      if (!res.ok || data.error) throw new Error(data.error || "Something went wrong.");
      setResult(data);
      setTab("fullMessage");
      const entry = {
        id: Date.now().toString(36),
        date: new Date().toISOString(),
        url: url.trim(),
        name: data.profile?.fullName || "Unknown",
        role: [data.profile?.currentRole, data.profile?.currentCompany].filter(Boolean).join(" · "),
        city: data.profile?.currentCity && data.profile.currentCity !== "Unknown" ? data.profile.currentCity : "",
        score: data.acceptance?.score,
        likelihood: data.acceptance?.likelihood,
        language: data.background?.nativeLanguage && data.background.nativeLanguage !== "Unknown" ? data.background.nativeLanguage : "",
        status: "Drafted",
        result: data,
      };
      setActiveId(entry.id);
      updateHistory([entry, ...history].slice(0, 200));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      refreshUsage();
    }
  }

  function editMessage(field, value) {
    const next = { ...result, [field]: value };
    setResult(next);
    if (activeId) updateHistory(history.map((h) => (h.id === activeId ? { ...h, result: next } : h)));
  }

  async function copy(text, key) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setError("Couldn't copy to the clipboard. Select the text and copy it manually.");
    }
  }

  function openEntry(h) {
    setResult(h.result);
    setActiveId(h.id);
    setUrl(h.url || "");
    setTab("fullMessage");
    setShowHistory(false);
  }

  function clearInputs() {
    setUrl("");
    setProfileText("");
    setPdf(null);
    setExtra("");
    setHonorific("auto");
    if (fileRef.current) fileRef.current.value = "";
  }

  const p = result?.profile;
  const bg = result?.background;
  const acc = result?.acceptance;
  const ss = result?.socialSignals;
  const activeEntry = history.find((h) => h.id === activeId);
  const current = result ? result[tab] || "" : "";
  const tabInfo = TABS.find((t) => t.id === tab);
  const words = current.trim() ? current.trim().split(/\s+/).length : 0;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="logo" src="/brand/entri-logo-white.png" alt="Entri" width={116} height={44} />
          <span className="divider" aria-hidden />
          <div>
            <h1>Podcast Guest Predictor &amp; Invite Generator</h1>
            <p>Entri Podcast · Find who'll say yes, then send them the perfect invite</p>
          </div>
        </div>
        <div className="topActions">
          <button className="ghost" onClick={() => setShowHistory(true)}>
            History {history.length > 0 && <span className="badge">{history.length}</span>}
          </button>
          <button className="ghost" onClick={() => { refreshUsage(); setShowUsage(true); }}>
            API usage {usage && <span className="badge">{usage.todayTotals.calls} today</span>}
          </button>
          <button className="ghost" onClick={() => setShowSettings(true)}>Settings</button>
        </div>
      </header>

      <main className="grid">
        <form className="card inputCard" onSubmit={generate}>
          <h2>Guest profile</h2>

          <label className="field">
            <span>LinkedIn profile URL</span>
            <input
              type="url"
              placeholder="https://www.linkedin.com/in/username"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>

          <div className="tip">
            LinkedIn blocks most automated access, so a URL alone may not work. For the best results, paste the whole profile page, including the follower count and the Activity section, which help predict whether they&apos;ll say yes.
          </div>

          <label className="field">
            <span>Profile text <em>(recommended)</em></span>
            <textarea
              rows={7}
              placeholder="Open the profile, select everything (Cmd+A), copy and paste it here: headline, About, Experience…"
              value={profileText}
              onChange={(e) => setProfileText(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Or upload the profile PDF</span>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              onChange={(e) => setPdf(e.target.files?.[0] || null)}
            />
            <small>On LinkedIn: open the profile → More → Save to PDF</small>
          </label>

          <div className="row">
            <label className="field">
              <span>Honorific</span>
              <select value={honorific} onChange={(e) => setHonorific(e.target.value)}>
                <option value="auto">Auto-detect</option>
                <option value="garu">garu</option>
                <option value="ji">ji</option>
                <option value="Sir">Sir</option>
                <option value="Ma'am">Ma&apos;am</option>
                <option value="none">None</option>
              </select>
            </label>
            <label className="field grow">
              <span>Extra notes <em>(optional)</em></span>
              <input
                placeholder="e.g. mention their recent post on AI"
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
              />
            </label>
          </div>

          <label className="check">
            <input type="checkbox" checked={nativeGreeting} onChange={(e) => setNativeGreeting(e.target.checked)} />
            <span>Start with a greeting in their native language <em>(e.g. Vanakkam, Namaskaram, Namaste)</em></span>
          </label>

          {error && <div className="error" role="alert">{error}</div>}

          <div className="formActions">
            <button type="submit" className="primary" disabled={loading}>
              {loading ? "Studying profile…" : result ? "Generate again" : "Generate invitation"}
            </button>
            <button type="button" className="ghost" onClick={clearInputs} disabled={loading}>Clear</button>
          </div>
        </form>

        <section className="card outputCard">
          {!result && !loading && (
            <div className="empty">
              <div className="emptyIcon" aria-hidden><span className="tipMark" /></div>
              <h3>Your guest prediction will appear here</h3>
              <p>Add a guest&apos;s profile on the left. You&apos;ll see how likely they are to say yes and why, plus a ready-to-send invitation.</p>
            </div>
          )}
          {loading && (
            <div className="empty">
              <div className="spinner" />
              <h3>Studying the profile…</h3>
              <p>Scoring their audience, activity and story, and drafting the invite.</p>
            </div>
          )}

          {result && !loading && (
            <>
              <div className="profileHead">
                <div>
                  <h2>{p?.fullName}</h2>
                  <p className="muted">
                    {[p?.currentRole, p?.currentCompany].filter(Boolean).join(" · ")}
                    {p?.location ? ` · ${p.location}` : ""}
                  </p>
                </div>
                {activeEntry && (
                  <select
                    className="status"
                    value={activeEntry.status}
                    onChange={(e) =>
                      updateHistory(history.map((h) => (h.id === activeId ? { ...h, status: e.target.value } : h)))
                    }
                  >
                    {STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                )}
              </div>

              {acc && <PredictionCard acc={acc} ss={ss} />}

              <div className="facts">
                <div><span>Experience</span>{p?.totalExperience || "—"}</div>
                <div><span>Domain</span>{p?.domain || "—"}</div>
                <div><span>Current city</span>{p?.currentCity && p.currentCity !== "Unknown" ? p.currentCity : "—"}</div>
              </div>

              <div className="background">
                <div className="bgBlock">
                  <span className="label">Studied at</span>
                  {p?.education?.length ? (
                    <ul className="eduList">
                      {p.education.map((e, i) => (
                        <li key={i}>
                          <strong>{e.institution}</strong>
                          {e.place && <span className="place"> · {e.place}</span>}
                          {(e.degree || e.years) && (
                            <div className="muted small">{[e.degree, e.years].filter(Boolean).join(" · ")}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted small">Not listed on the profile</p>
                  )}
                </div>
                <div className="bgBlock">
                  <span className="label">Likely native language</span>
                  <p className="lang">
                    {bg?.nativeLanguage || "Unknown"}
                    {bg?.confidence && <span className={`conf conf${bg.confidence}`}>{bg.confidence} confidence</span>}
                  </p>
                  {bg?.nativeRegion && bg.nativeRegion !== "Unknown" && (
                    <p className="muted small">Likely from {bg.nativeRegion}</p>
                  )}
                  {bg?.nativeGreeting && (
                    <p className="small">Greeting in {bg.nativeLanguage}: <strong>{bg.nativeGreeting}</strong></p>
                  )}
                  <p className="small">Addressed as: <strong>{result.honorific ? `${p?.firstName} ${result.honorific}` : p?.firstName}</strong></p>
                </div>
              </div>
              {bg?.signals?.length > 0 && (
                <details className="details signals">
                  <summary>How the language was guessed</summary>
                  <ul>{bg.signals.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  <p className="muted small">This is a guess based on name and education. It only decides the greeting and is never mentioned in the message.</p>
                </details>
              )}

              <div className="hook">
                <span>The hook</span>
                <p>{result.hook}</p>
              </div>

              {result.warnings?.length > 0 && (
                <div className="warn">
                  <strong>Check before sending</strong>
                  <ul>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </div>
              )}

              <div className="tabs" role="tablist">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={tab === t.id}
                    className={tab === t.id ? "tab active" : "tab"}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="messageBox">
                <div className="messageMeta">
                  <span>{tabInfo.hint}</span>
                  <span className={tabInfo.limit && current.length > tabInfo.limit ? "over" : ""}>
                    {current.length}{tabInfo.limit ? ` / ${tabInfo.limit}` : ""} chars · {words} words
                  </span>
                </div>
                <textarea
                  className="message"
                  value={current}
                  onChange={(e) => editMessage(tab, e.target.value)}
                  rows={tab === "fullMessage" ? 18 : 8}
                />
                <div className="formActions">
                  <button className="primary" onClick={() => copy(current, tab)}>
                    {copied === tab ? "Copied ✓" : "Copy message"}
                  </button>
                  {url && (
                    <a className="ghost linkBtn" href={url} target="_blank" rel="noreferrer">Open profile ↗</a>
                  )}
                  {result.tokensUsed > 0 && (
                    <span className="muted small tokenNote">{fmt(result.tokensUsed)} tokens · {result.model}</span>
                  )}
                </div>
              </div>

              <details className="details">
                <summary>Profile summary</summary>
                <p>{p?.aboutSummary}</p>
                {p?.careerPath?.length > 0 && (
                  <>
                    <h4>Career path</h4>
                    <ol>{p.careerPath.map((c, i) => <li key={i}>{c}</li>)}</ol>
                  </>
                )}
                {p?.skills?.length > 0 && (
                  <div className="chips">{p.skills.map((s, i) => <span key={i}>{s}</span>)}</div>
                )}
              </details>

              <details className="details">
                <summary>What I personalized</summary>
                <ul>{result.personalizationNotes?.map((n, i) => <li key={i}>{n}</li>)}</ul>
                <p className="muted small">Honorific: {result.honorificReason}</p>
              </details>
            </>
          )}
        </section>
      </main>

      {showUsage && <UsageModal usage={usage} onRefresh={refreshUsage} onClose={() => setShowUsage(false)} />}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={(s) => {
            setSettings(s);
            save(SETTINGS_KEY, s);
            setShowSettings(false);
          }}
        />
      )}

      {showHistory && (
        <div className="overlay" onClick={() => setShowHistory(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawerHead">
              <h2>Guest history</h2>
              <button className="ghost" onClick={() => setShowHistory(false)}>Close</button>
            </div>
            {history.length === 0 && <p className="muted">No invitations yet.</p>}
            <ul className="historyList">
              {history.map((h) => (
                <li key={h.id}>
                  <button className="historyMain" onClick={() => openEntry(h)}>
                    <strong>
                      {h.name}
                      {typeof h.score === "number" && <span className={`conf conf${h.likelihood || "Low"} histScore`}>{h.score}% yes</span>}
                    </strong>
                    <span className="muted small">{h.role}</span>
                    <span className="muted small">
                      {[h.city, h.language, new Date(h.date).toLocaleDateString()].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                  <div className="historySide">
                    <select
                      value={h.status}
                      onChange={(e) =>
                        updateHistory(history.map((x) => (x.id === h.id ? { ...x, status: e.target.value } : x)))
                      }
                    >
                      {STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                    <button
                      className="link danger"
                      onClick={() => {
                        if (confirm(`Remove ${h.name} from history?`)) updateHistory(history.filter((x) => x.id !== h.id));
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      )}
    </div>
  );
}

const VERDICT = {
  High: { text: "Likely to say yes", cls: "vHigh" },
  Medium: { text: "Worth a try", cls: "vMedium" },
  Low: { text: "Long shot", cls: "vLow" },
};

function ScoreRing({ score }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <svg className="ring" viewBox="0 0 128 128" role="img" aria-label={`${score} out of 100`}>
      <circle cx="64" cy="64" r={r} className="ringTrack" />
      <circle
        cx="64" cy="64" r={r} className="ringFill"
        strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 64 64)"
      />
      <text x="64" y="62" textAnchor="middle" className="ringNum">{score}</text>
      <text x="64" y="84" textAnchor="middle" className="ringOf">out of 100</text>
    </svg>
  );
}

function PredictionCard({ acc, ss }) {
  const v = VERDICT[acc.likelihood] || VERDICT.Low;
  const criteria = acc.criteria;
  return (
    <section className="predict" aria-label="Guest prediction">
      <div className="predictHead">
        <h3><span className="tipMark light" aria-hidden />Guest prediction</h3>
      </div>
      <div className="predictTop">
        <ScoreRing score={acc.score} />
        <div className="predictVerdict">
          <span className={`verdict ${v.cls}`}>{v.text}</span>
          <p className="predictSummary">{acc.summary}</p>
          {criteria && (
            <p className={`coverage${acc.dataCoverage < 3 ? " low" : ""}`}>
              Based on {acc.dataCoverage} of {criteria.length} criteria found in the profile
              {acc.dataCoverage < 3 && ". Paste the follower count and Activity section for a sharper prediction."}
            </p>
          )}
        </div>
      </div>

      {ss && (
        <div className="signalsGrid">
          <div><span className="label">Followers</span>{ss.followers}</div>
          <div><span className="label">Connections</span>{ss.connections}</div>
          <div><span className="label">Posts on LinkedIn</span>{ss.postingActivity}</div>
          <div><span className="label">Public speaking</span>{ss.publicSpeaking}</div>
        </div>
      )}

      {criteria ? (
        <div className="criteria">
          <div className="criteriaHead">
            <span className="label">How we predicted it</span>
            <span className="label">Points</span>
          </div>
          <ol className="critList">
            {criteria.map((c) => {
              const level = c.score >= 7 ? "good" : c.score >= 4 ? "mid" : "poor";
              return (
                <li key={c.id} className={c.found ? "" : "missing"}>
                  <div className="critRow">
                    <div className="critName">
                      <span className="tipMark" aria-hidden />
                      <strong>{c.label}</strong>
                      <span className="weight">{c.weight}% weight</span>
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
            Each criterion gets a score from 0 to 10 based on the profile. That score × its weight gives the points, and the points add up to the total.
            Missing information counts as 5/10, so it neither helps nor hurts. 65+ = likely, 45–64 = worth a try, under 45 = long shot.
          </p>
        </div>
      ) : (
        acc.factors?.length > 0 && (
          <ul className="critList legacy">
            {acc.factors.map((f, i) => <li key={i}><strong>{f.factor}</strong> {f.detail}</li>)}
          </ul>
        )
      )}

      {acc.tips?.length > 0 && (
        <div className="tipsBox">
          <span className="label">Tips to get a yes</span>
          <ul>{acc.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      )}
      <p className="muted small disclaimer">An estimate from the profile text only, not a guarantee.</p>
    </section>
  );
}

const LIMIT_KEY = "epi.dailyLimit.v1";
const fmt = (n) => (n ?? 0).toLocaleString("en-IN");

function UsageModal({ usage, onRefresh, onClose }) {
  const [limit, setLimit] = useState("");
  useEffect(() => {
    try {
      setLimit(localStorage.getItem(LIMIT_KEY) || "");
    } catch {}
  }, []);
  function saveLimit(v) {
    setLimit(v);
    try {
      localStorage.setItem(LIMIT_KEY, v);
    } catch {}
  }
  if (!usage) {
    return (
      <div className="overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}><p className="muted">Loading usage…</p></div>
      </div>
    );
  }
  const t = usage.todayTotals;
  const lim = parseInt(limit, 10);
  const hasLimit = Number.isFinite(lim) && lim > 0;
  const left = hasLimit ? Math.max(0, lim - t.calls) : null;
  const pct = hasLimit ? Math.min(100, (t.calls / lim) * 100) : 0;
  const maxDay = Math.max(1, ...usage.last7Days.map((d) => d.calls));

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="drawerHead">
          <h2>Gemini API usage</h2>
          <div className="formActions">
            <button className="ghost" onClick={onRefresh}>Refresh</button>
            <button className="ghost" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="usageHero">
          <div>
            <span className="label">Used today</span>
            <p className="bigNum">{fmt(t.calls)} <small>requests</small></p>
            <p className="muted small">{fmt(t.invitations)} invitations · {fmt(t.total)} tokens{t.failed ? ` · ${t.failed} failed (busy model)` : ""}</p>
          </div>
          <div>
            <span className="label">Left today</span>
            <p className="bigNum">{hasLimit ? fmt(left) : "—"} {hasLimit && <small>of {fmt(lim)}</small>}</p>
            <p className="muted small">Resets at {usage.resetsAt}</p>
          </div>
        </div>
        {hasLimit && (
          <div className={`meter usageMeter${pct >= 90 ? " danger" : pct >= 70 ? " warnM" : ""}`}><div style={{ width: `${pct}%` }} /></div>
        )}

        <label className="field">
          <span>Your daily request limit</span>
          <input type="number" min="1" placeholder="e.g. 250" value={limit} onChange={(e) => saveLimit(e.target.value)} />
          <small>
            Google doesn&apos;t let apps read your remaining quota, so enter your limit here. Find it at{" "}
            <a href="https://aistudio.google.com/rate-limit" target="_blank" rel="noreferrer">AI Studio → Rate limits</a>.
          </small>
        </label>

        {Object.keys(usage.todayByModel).length > 0 && (
          <div>
            <span className="label">Today by model</span>
            <table className="usageTable">
              <thead><tr><th>Model</th><th>Requests</th><th>Failed</th><th>Tokens</th></tr></thead>
              <tbody>
                {Object.entries(usage.todayByModel).map(([m, v]) => (
                  <tr key={m}><td>{m}</td><td>{fmt(v.calls)}</td><td>{fmt(v.failed)}</td><td>{fmt(v.total)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <span className="label">Last 7 days (requests)</span>
          <div className="bars">
            {usage.last7Days.map((d) => (
              <div key={d.day} className="barCol" title={`${d.day}: ${d.calls} requests, ${fmt(d.total)} tokens`}>
                <span className="barVal">{d.calls || ""}</span>
                <div className="bar" style={{ height: `${(d.calls / maxDay) * 100}%` }} />
                <span className="barDay">{new Date(d.day + "T12:00:00").toLocaleDateString("en-IN", { weekday: "short" })}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="facts">
          <div><span>This month</span>{fmt(usage.monthTotals.calls)} requests<br /><small className="muted">{fmt(usage.monthTotals.total)} tokens</small></div>
          <div><span>Invitations this month</span>{fmt(usage.monthTotals.invitations)}</div>
          <div><span>All time</span>{fmt(usage.allTime.calls)} requests<br /><small className="muted">{fmt(usage.allTime.total)} tokens</small></div>
        </div>

        <p className="muted small">
          Counted by this app since {usage.since ? new Date(usage.since).toLocaleDateString("en-IN") : "today"}. Calls made with the same key elsewhere aren&apos;t included. For Google&apos;s official numbers, see{" "}
          <a href="https://aistudio.google.com/usage" target="_blank" rel="noreferrer">AI Studio → Usage</a>.
        </p>
      </div>
    </div>
  );
}

function SettingsModal({ settings, onClose, onSave }) {
  const [s, setS] = useState(settings);
  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="drawerHead">
          <h2>Settings</h2>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
        <div className="row">
          <label className="field grow"><span>Your name</span><input value={s.senderName} onChange={set("senderName")} /></label>
          <label className="field grow"><span>Podcast name</span><input value={s.podcastName} onChange={set("podcastName")} /></label>
        </div>
        <label className="field"><span>Your role</span><input value={s.senderRole} onChange={set("senderRole")} /></label>
        <label className="field"><span>What the podcast is about</span><input value={s.podcastAbout} onChange={set("podcastAbout")} /></label>
        <label className="field"><span>Format</span><input value={s.format} onChange={set("format")} /></label>
        <label className="field">
          <span>Full message template</span>
          <textarea rows={14} value={s.template} onChange={set("template")} />
          <small>Words in {"{curly braces}"} are filled in from the guest&apos;s profile. Everything else stays as written.</small>
        </label>
        <label className="field">
          <span>Connection note template</span>
          <textarea rows={4} value={s.connectionTemplate} onChange={set("connectionTemplate")} />
        </label>
        <div className="formActions">
          <button className="primary" onClick={() => onSave(s)}>Save settings</button>
          <button className="ghost" onClick={() => setS(DEFAULT_SETTINGS)}>Reset to defaults</button>
        </div>
      </div>
    </div>
  );
}
