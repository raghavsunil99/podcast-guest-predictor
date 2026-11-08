"use client";

import { useEffect, useState } from "react";
import Icon from "./icons";
import { Segmented, ThemeSwitcher, fmt, timeAgo } from "./ui";
import { exportCSV } from "./Guests";
import { DEFAULT_SETTINGS } from "@/lib/defaults";

const LIMIT_KEY = "epi.dailyLimit.v1";

export default function Settings({ settings, onSave, usage, refreshUsage, guests, providers, refreshProviders, themePref, setThemePref, tab, setTab, flash }) {
  return (
    <div className="stack16 settingsPage">
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "providers", label: "AI providers" },
          { value: "usage", label: "API usage" },
          { value: "podcast", label: "Podcast & templates" },
          { value: "workflow", label: "Workflow" },
          { value: "appearance", label: "Appearance" },
          { value: "data", label: "Data" },
        ]}
      />
      {tab === "providers" && <ProvidersPanel providers={providers} refresh={() => { refreshProviders(); refreshUsage(); }} usage={usage} flash={flash} />}
      {tab === "usage" && <UsagePanel usage={usage} onRefresh={refreshUsage} providers={providers} />}
      {tab === "podcast" && <PodcastSettings settings={settings} onSave={onSave} />}
      {tab === "workflow" && <WorkflowSettings settings={settings} onSave={onSave} />}
      {tab === "appearance" && (
        <div className="card stack12">
          <h3>Theme</h3>
          <p className="muted small">System follows your computer&apos;s light or dark setting. Your choice is remembered in this browser.</p>
          <ThemeSwitcher pref={themePref} onChange={setThemePref} labels />
        </div>
      )}
      {tab === "data" && <StorageStatus />}
      {tab === "data" && (
        <div className="card stack12">
          <h3>Your data</h3>
          <p className="muted small">
            Guests, notes, history, photos and settings are stored where the box above says. AI provider keys are stored encrypted
            (AES-256-GCM, key in <code>.env.local</code>) and are never sent to the browser. The theme choice stays in each browser.
          </p>
          <div className="row gap8 wrap">
            <button className="btn" onClick={() => exportCSV(guests, "all-guests")} disabled={!guests.length}>
              <Icon name="download" size={15} />Export all {guests.length} guests (CSV, opens in Excel)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const ERR_LABEL = { auth: "Invalid key", rate: "Rate limited", quota: "Out of quota", busy: "Busy / timeout", notfound: "Model not found", bad: "Request rejected", other: "Error", nokey: "No key" };
const jsonFetch = async (url, opts = {}) => {
  const r = await fetch(url, { ...opts, headers: { "Content-Type": "application/json" }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Request failed");
  return d;
};

function ProvidersPanel({ providers, refresh, usage, flash }) {
  const [types, setTypes] = useState([]);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    fetch("/api/providers").then((r) => r.json()).then((d) => setTypes(d.types || [])).catch(() => {});
  }, []);
  const enabled = providers.filter((p) => p.enabled && p.hasKey);
  return (
    <div className="stack12">
      <div className="card providerIntro">
        <div className="grow">
          <h3>AI providers</h3>
          <p className="muted small">
            Requests go to the first enabled provider. If it hits a rate limit, runs out of quota, is overloaded or times out, the next one is tried automatically and you&apos;re told which answered.
            An invalid key stops the request and asks you to fix it instead of switching silently.
          </p>
        </div>
        <button className="btn btnPrimary" onClick={() => setAdding((v) => !v)}><Icon name={adding ? "x" : "plus"} size={15} />{adding ? "Cancel" : "Add provider"}</button>
      </div>
      {adding && <AddProvider types={types} onDone={() => { setAdding(false); refresh(); }} flash={flash} />}
      {!providers.length && <p className="alert alertWarn">No AI provider is set up. Add one to study profiles.</p>}
      {providers.length > 0 && !enabled.length && <p className="alert alertWarn">No enabled provider has a key, so AI features won&apos;t work.</p>}
      <ol className="providerList">
        {providers.map((p, i) => (
          <ProviderCard key={p.id} p={p} index={i} count={providers.length} usage={usage?.byProvider?.[p.id]} refresh={refresh} flash={flash} />
        ))}
      </ol>
      <p className="muted tiny">Gemini, OpenAI and Claude read PDFs directly; other providers (including local Ollama models) get the PDF&apos;s extracted text. Researching a bare LinkedIn URL needs Gemini (web search).</p>
    </div>
  );
}

function AddProvider({ types, onDone, flash }) {
  const [f, setF] = useState({ type: "openai", name: "", apiKey: "", model: "", baseUrl: "", dailyLimit: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const t = types.find((x) => x.type === f.type);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await jsonFetch("/api/providers", { method: "POST", body: { ...f, name: f.name || t?.label, model: f.model || t?.defaultModel } });
      flash(`${f.name || t?.label} added`);
      onDone();
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card stack12" onSubmit={save}>
      <h3>Add a provider</h3>
      <div className="formGrid">
        <label className="field">
          <span>Provider</span>
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, model: "" })}>
            {types.map((x) => <option key={x.type} value={x.type}>{x.label}</option>)}
          </select>
        </label>
        <label className="field"><span>Display name</span><input value={f.name} onChange={set("name")} placeholder={t?.label} /></label>
        {t?.needsKey === false ? (
          <div className="span2 alert alertOk small">
            Runs on this computer: free, no API key, no usage limits. Install <a href={t.keyUrl} target="_blank" rel="noreferrer">Ollama</a>, then download a model, e.g. <code>ollama pull qwen3:8b</code>. Tip: keep it last in the priority list so it takes over when cloud quotas run out.
          </div>
        ) : (
          <label className="field span2">
            <span>API key {t?.keyUrl && <a className="tiny" href={t.keyUrl} target="_blank" rel="noreferrer">Get a key ↗</a>}</span>
            <div className="inputIcon"><Icon name="key" size={16} /><input type="password" autoComplete="off" value={f.apiKey} onChange={set("apiKey")} placeholder="Stored encrypted on this computer" required /></div>
          </label>
        )}
        <label className="field">
          <span>Model</span>
          <input list={`models-${f.type}`} value={f.model} onChange={set("model")} placeholder={t?.defaultModel || "model id"} required={!t?.defaultModel} />
          <datalist id={`models-${f.type}`}>{(t?.suggestedModels || []).map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <label className="field"><span>Daily request limit <em>optional</em></span><input type="number" min="1" value={f.dailyLimit} onChange={set("dailyLimit")} placeholder="for alerts" /></label>
        {(t?.needsBaseUrl || f.type === "deepseek" || f.type === "ollama") && (
          <label className="field span2"><span>API base URL</span><input value={f.baseUrl} onChange={set("baseUrl")} placeholder={t?.defaultBaseUrl || "https://openrouter.ai/api/v1"} required={t?.needsBaseUrl} /></label>
        )}
      </div>
      {t && (
        <p className="muted tiny">
          Supports: {t.capabilities.pdf ? "PDF profiles" : t.capabilities.pdfText || t.capabilities.schema ? "PDF profiles (as extracted text)" : "text profiles only"}{t.capabilities.web ? ", URL research" : ""}{t.capabilities.local ? ". Slower than cloud: about 15–40 s per profile" : ""}.
        </p>
      )}
      {err && <div className="alert alertError">{err}</div>}
      <div className="row gap8"><button className="btn btnPrimary" disabled={busy}>{busy ? <span className="btnSpinner" /> : <Icon name="check" size={15} />}Save provider</button></div>
    </form>
  );
}

function ProviderCard({ p, index, count, usage, refresh, flash }) {
  const [edit, setEdit] = useState({ model: p.model || "", fallbackModels: (p.fallbackModels || []).join(", "), dailyLimit: p.dailyLimit || "", warnAt: p.warnAt || 80, apiKey: "" });
  const [models, setModels] = useState(p.suggestedModels || []);
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState("");
  useEffect(() => setEdit({ model: p.model || "", fallbackModels: (p.fallbackModels || []).join(", "), dailyLimit: p.dailyLimit || "", warnAt: p.warnAt || 80, apiKey: "" }), [p]);

  const patch = async (body, msg) => {
    try {
      await jsonFetch(`/api/providers/${p.id}`, { method: "PATCH", body });
      if (msg) flash(msg);
      refresh();
    } catch (e) {
      flash(e.message);
    }
  };
  async function runTest() {
    setBusy("test");
    setTest(null);
    try {
      setTest(await jsonFetch(`/api/providers/${p.id}`, { method: "PATCH", body: { action: "test" } }));
      refresh();
    } catch (e) {
      setTest({ ok: false, message: e.message });
    } finally {
      setBusy("");
    }
  }
  async function loadModels() {
    setBusy("models");
    try {
      const d = await jsonFetch(`/api/providers/${p.id}`, { method: "PATCH", body: { action: "models" } });
      setModels(d.models);
      flash(`${d.models.length} models available`);
    } catch (e) {
      flash(e.message);
    } finally {
      setBusy("");
    }
  }
  const st = p.status || {};
  const cooling = st.cooldownUntil && new Date(st.cooldownUntil) > new Date();
  const health = !p.hasKey ? ["warn", "No key"] : st.authFailed ? ["bad", "Key rejected"] : cooling ? ["warn", "Cooling down"] : st.lastOkAt ? ["good", "Working"] : ["idle", "Not tested"];
  const t = usage?.today;
  const rl = st.rateLimit;

  return (
    <li className={`providerCard${p.enabled ? "" : " off"}`}>
      <div className="pcHead">
        <span className="pcRank">{index + 1}</span>
        <span className={`pcLogo pc-${p.type}`}>{p.typeLabel.charAt(0)}</span>
        <div className="grow">
          <strong>{p.name}</strong>
          <span className="muted small block">{p.typeLabel} · {p.model}{index === 0 && p.enabled ? " · default" : ""}</span>
        </div>
        <span className={`health h-${health[0]}`}><span />{health[1]}</span>
        <label className="switch small" title={p.enabled ? "Disable" : "Enable"}>
          <input type="checkbox" checked={p.enabled} onChange={(e) => patch({ enabled: e.target.checked }, `${p.name} ${e.target.checked ? "enabled" : "disabled"}`)} />
          <span className="switchTrack" aria-hidden />
        </label>
      </div>

      <div className="pcStats">
        <div><b>{fmt(t?.calls)}</b><span>Requests today{p.dailyLimit ? ` / ${fmt(p.dailyLimit)}` : ""}</span></div>
        <div><b>{fmt(t?.failed)}</b><span>Failed today</span></div>
        <div><b>{fmt(t?.total)}</b><span>Tokens today</span></div>
        <div><b>{rl?.requestsRemaining != null ? fmt(rl.requestsRemaining) : "—"}</b><span>Requests left (provider)</span></div>
      </div>
      {p.dailyLimit ? (
        <div className={`meter${usage?.pct >= 90 ? " danger" : usage?.pct >= (p.warnAt || 80) ? " warn" : ""}`}><div style={{ width: `${Math.min(100, usage?.pct || 0)}%` }} /></div>
      ) : null}
      {t?.errors && Object.keys(t.errors).length > 0 && (
        <div className="errChips">
          {Object.entries(t.errors).map(([k, v]) => <span key={k} className={`errChip e-${k}`}>{ERR_LABEL[k] || k} × {v}</span>)}
        </div>
      )}
      {st.lastError && (
        <p className="muted tiny">Last error {timeAgo(st.lastError.at)}: {ERR_LABEL[st.lastError.type] || st.lastError.type}{st.lastError.model ? ` (${st.lastError.model})` : ""}{cooling ? ` · skipped until ${new Date(st.cooldownUntil).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : ""}</p>
      )}

      <details className="pcEdit">
        <summary>Edit model, key and limits</summary>
        <div className="formGrid">
          <label className="field">
            <span>Preferred model <button type="button" className="linkBtn tiny" onClick={loadModels} disabled={!!busy}>{busy === "models" ? "Loading…" : "Load available models"}</button></span>
            <input list={`m-${p.id}`} value={edit.model} onChange={(e) => setEdit({ ...edit, model: e.target.value })} />
            <datalist id={`m-${p.id}`}>{models.map((m) => <option key={m} value={m} />)}</datalist>
          </label>
          <label className="field">
            <span>Backup models <em>same provider, comma-separated</em></span>
            <input value={edit.fallbackModels} onChange={(e) => setEdit({ ...edit, fallbackModels: e.target.value })} placeholder="tried if the main model is busy" />
          </label>
          <label className="field">
            <span>Daily request limit <em>for alerts</em></span>
            <input type="number" min="1" value={edit.dailyLimit} onChange={(e) => setEdit({ ...edit, dailyLimit: e.target.value })} placeholder="e.g. 250" />
          </label>
          <label className="field">
            <span>Alert at</span>
            <div className="row gap8"><input type="number" min="1" max="100" value={edit.warnAt} onChange={(e) => setEdit({ ...edit, warnAt: e.target.value })} /><span className="muted small">% of limit</span></div>
          </label>
          {p.needsKey === false ? (
            <p className="span2 muted small">No API key needed: runs locally{p.baseUrl ? ` at ${p.baseUrl}` : ""}.</p>
          ) : (
          <label className="field span2">
            <span>
              API key{" "}
              <span className="muted tiny">
                {p.keySource === "encrypted" ? `saved encrypted (${p.keyHint})` : p.keySource.startsWith("env:") ? `from .env.local (${p.keySource.slice(4)})` : "not set"}
              </span>
            </span>
            <div className="inputIcon"><Icon name="key" size={16} /><input type="password" autoComplete="off" value={edit.apiKey} onChange={(e) => setEdit({ ...edit, apiKey: e.target.value })} placeholder="Paste a new key to replace it" /></div>
          </label>
          )}
        </div>
        <div className="row gap8 wrap">
          <button
            className="btn btnPrimary btnSm"
            onClick={() => patch({ model: edit.model, fallbackModels: edit.fallbackModels, dailyLimit: edit.dailyLimit || null, warnAt: edit.warnAt, ...(edit.apiKey ? { apiKey: edit.apiKey } : {}) }, `${p.name} saved`)}
          >
            <Icon name="check" size={14} />Save
          </button>
        </div>
      </details>

      <div className="pcActions">
        <button className="btn btnSm" onClick={runTest} disabled={!!busy || !p.hasKey}>{busy === "test" ? <span className="btnSpinner" /> : <Icon name="plug" size={14} />}Test connection</button>
        {index > 0 && <button className="btn btnSm" onClick={() => patch({ move: "top" }, `${p.name} is now the default`)}>Make default</button>}
        <button className="iconBtn sm" disabled={index === 0} onClick={() => patch({ move: "up" })} title="Higher priority"><Icon name="arrowUp" size={14} /></button>
        <button className="iconBtn sm" disabled={index === count - 1} onClick={() => patch({ move: "down" })} title="Lower priority"><Icon name="arrowDown" size={14} /></button>
        <button className="btn btnSm btnDanger push" onClick={() => confirm(`Remove ${p.name}? Its saved key will be deleted.`) && fetch(`/api/providers/${p.id}`, { method: "DELETE" }).then(refresh)}>
          <Icon name="trash" size={14} />Remove
        </button>
      </div>
      {test && (
        <div className={`alert ${test.ok ? "alertOk" : "alertError"}`}>
          {test.ok
            ? `Connected to ${test.model} in ${(test.latencyMs / 1000).toFixed(1)}s.${test.rateLimit?.requestsRemaining != null ? ` ${fmt(test.rateLimit.requestsRemaining)} requests left in the current window.` : ""}`
            : `${ERR_LABEL[test.type] || "Failed"}: ${test.message}`}
        </div>
      )}
    </li>
  );
}

function StorageStatus() {
  const [s, setS] = useState(null);
  useEffect(() => {
    fetch("/api/storage", { cache: "no-store" }).then((r) => r.json()).then(setS).catch(() => setS({ mode: "unknown" }));
  }, []);
  if (!s) return <div className="card"><p className="muted">Checking storage…</p></div>;
  return (
    <div className="card stack8">
      <div className="row gap8">
        <Icon name={s.mode === "database" ? "globe" : "archive"} size={18} />
        <h3 className="grow">{s.mode === "database" ? "Cloud database" : "Stored on this computer"}</h3>
        <span className={`health ${s.mode === "database" ? (s.ok ? "h-good" : "h-bad") : "h-warn"}`}><span />{s.mode === "database" ? (s.ok ? "Connected" : "Not reachable") : "Local only"}</span>
      </div>
      {s.mode === "database" ? (
        s.ok ? (
          <p className="muted small">Connected to <code>{s.where}</code>: {s.guests} guests, {s.photos} photos, {s.usageEvents} usage records. Any computer running this app with the same <code>.env.local</code> sees the same data.</p>
        ) : (
          <p className="alert alertError">Can&apos;t reach the database: {s.error}. Check DATABASE_URL in .env.local.</p>
        )
      ) : (
        <p className="muted small">
          Everything is in the <code>data</code> folder on this laptop, with no backup. To keep it in the cloud, add <code>DATABASE_URL</code> (Supabase or Neon) to <code>.env.local</code> and run the migration in the README.
        </p>
      )}
    </div>
  );
}

function useDraft(settings) {
  const [s, setS] = useState(settings);
  useEffect(() => setS(settings), [settings]);
  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });
  return [s, setS, set];
}

function SaveRow({ onSave, onReset }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="row gap8">
      <button className="btn btnPrimary" onClick={() => { onSave(); setOk(true); setTimeout(() => setOk(false), 1500); }}>
        <Icon name="check" size={15} />Save
      </button>
      {onReset && <button className="btn" onClick={onReset}>Reset to defaults</button>}
      {ok && <span className="savedFlash">Saved</span>}
    </div>
  );
}

function PodcastSettings({ settings, onSave }) {
  const [s, setS, set] = useDraft(settings);
  return (
    <div className="card stack12">
      <div className="formGrid">
        <label className="field"><span>Your name</span><input value={s.senderName} onChange={set("senderName")} /></label>
        <label className="field"><span>Podcast name</span><input value={s.podcastName} onChange={set("podcastName")} /></label>
        <label className="field span2"><span>Your role</span><input value={s.senderRole} onChange={set("senderRole")} /></label>
        <label className="field span2"><span>What the podcast is about</span><input value={s.podcastAbout} onChange={set("podcastAbout")} /></label>
        <label className="field span2"><span>Format</span><input value={s.format} onChange={set("format")} /></label>
      </div>
      <label className="field">
        <span>Invitation template</span>
        <textarea rows={14} value={s.template} onChange={set("template")} />
        <small>Words in {"{curly braces}"} are filled in from the guest&apos;s profile. Everything else stays as written.</small>
      </label>
      <label className="field">
        <span>Connection note template</span>
        <textarea rows={4} value={s.connectionTemplate} onChange={set("connectionTemplate")} />
      </label>
      <SaveRow onSave={() => onSave(s)} onReset={() => setS({ ...DEFAULT_SETTINGS, guestCriteria: s.guestCriteria, followUpDays: s.followUpDays })} />
    </div>
  );
}

function WorkflowSettings({ settings, onSave }) {
  const [s, , set] = useDraft(settings);
  return (
    <div className="card stack12">
      <label className="field">
        <span>What makes a great guest</span>
        <textarea rows={4} value={s.guestCriteria} onChange={set("guestCriteria")} />
        <small>Used by Recommendations to suggest companies and profile types.</small>
      </label>
      <label className="field narrow">
        <span>Follow-up reminder after</span>
        <div className="row gap8">
          <input type="number" min="1" max="60" value={s.followUpDays} onChange={set("followUpDays")} />
          <span className="muted small">days without a reply</span>
        </div>
      </label>
      <SaveRow onSave={() => onSave({ ...s, followUpDays: Math.max(1, parseInt(s.followUpDays, 10) || 5) })} />
    </div>
  );
}

function UsagePanel({ usage, onRefresh, providers = [] }) {
  const [limit, setLimit] = useState("");
  useEffect(() => {
    onRefresh();
    try {
      setLimit(localStorage.getItem(LIMIT_KEY) || "");
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function saveLimit(v) {
    setLimit(v);
    try {
      localStorage.setItem(LIMIT_KEY, v);
    } catch {}
  }
  if (!usage) return <div className="card"><p className="muted">Loading usage…</p></div>;
  const t = usage.todayTotals;
  const lim = parseInt(limit, 10);
  const hasLimit = Number.isFinite(lim) && lim > 0;
  const left = hasLimit ? Math.max(0, lim - t.calls) : null;
  const p = hasLimit ? Math.min(100, (t.calls / lim) * 100) : 0;
  const maxDay = Math.max(1, ...usage.last7Days.map((d) => d.calls));

  return (
    <div className="stack16">
      <div className="usageHero">
        <div className="card">
          <span className="statLabel">Used today</span>
          <p className="statValue">{fmt(t.calls)} <small>requests</small></p>
          <p className="muted small">{fmt(t.invitations)} profiles studied · {fmt(t.total)} tokens{t.failed ? ` · ${t.failed} failed (busy model)` : ""}</p>
        </div>
        <div className="card">
          <span className="statLabel">Left today</span>
          <p className="statValue">{hasLimit ? fmt(left) : "—"} {hasLimit && <small>of {fmt(lim)}</small>}</p>
          {hasLimit && <div className={`meter${p >= 90 ? " danger" : p >= 70 ? " warn" : ""}`}><div style={{ width: `${p}%` }} /></div>}
          <p className="muted small">Resets at {usage.resetsAt}</p>
        </div>
      </div>

      {providers.length > 0 && (
        <div className="card stack8">
          <h3>By provider (today)</h3>
          <div className="tableWrap">
            <table className="usageTable">
              <thead><tr><th>Provider</th><th>Requests</th><th>Limit</th><th>Failed</th><th>Errors</th><th>Tokens</th><th>Month</th></tr></thead>
              <tbody>
                {providers.map((p) => {
                  const u = usage.byProvider?.[p.id];
                  return (
                    <tr key={p.id}>
                      <td><strong>{p.name}</strong>{!p.enabled && <span className="muted tiny"> · off</span>}</td>
                      <td>{fmt(u?.today.calls)}</td>
                      <td>{p.dailyLimit ? `${u?.pct ?? 0}% of ${fmt(p.dailyLimit)}` : "—"}</td>
                      <td>{fmt(u?.today.failed)}</td>
                      <td className="small">{u && Object.keys(u.today.errors).length ? Object.entries(u.today.errors).map(([k, v]) => `${ERR_LABEL[k] || k} ${v}`).join(", ") : "—"}</td>
                      <td>{fmt(u?.today.total)}</td>
                      <td>{fmt(u?.month.calls)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted tiny">Set daily limits per provider in AI providers to get alerts. Providers don&apos;t report remaining quota through their APIs, except rate-limit windows from OpenAI and Claude (shown on each provider card).</p>
        </div>
      )}

      <div className="card stack12">
        <div className="row gap8">
          <h3 className="grow">Last 7 days</h3>
          <button className="btn btnSm" onClick={onRefresh}><Icon name="refresh" size={14} />Refresh</button>
        </div>
        <div className="bars">
          {usage.last7Days.map((d) => (
            <div key={d.day} className="barCol" title={`${d.day}: ${d.calls} requests, ${fmt(d.total)} tokens`}>
              <span className="barVal">{d.calls || ""}</span>
              <div className="bar" style={{ height: `${(d.calls / maxDay) * 100}%` }} />
              <span className="barDay">{new Date(d.day + "T12:00:00").toLocaleDateString("en-IN", { weekday: "short" })}</span>
            </div>
          ))}
        </div>
        {Object.keys(usage.todayByModel).length > 0 && (
          <table className="usageTable">
            <thead><tr><th>Model (today)</th><th>Requests</th><th>Failed</th><th>Tokens</th></tr></thead>
            <tbody>
              {Object.entries(usage.todayByModel).map(([m, v]) => (
                <tr key={m}><td>{m}</td><td>{fmt(v.calls)}</td><td>{fmt(v.failed)}</td><td>{fmt(v.total)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="miniStats">
          <div><b>{fmt(usage.monthTotals.calls)}</b><span>Requests this month</span></div>
          <div><b>{fmt(usage.monthTotals.invitations)}</b><span>Profiles this month</span></div>
          <div><b>{fmt(usage.allTime.calls)}</b><span>All-time requests</span></div>
          <div><b>{fmt(usage.allTime.total)}</b><span>All-time tokens</span></div>
        </div>
      </div>

      <div className="card stack8">
        <label className="field narrow">
          <span>Your daily request limit</span>
          <input type="number" min="1" placeholder="e.g. 250" value={limit} onChange={(e) => saveLimit(e.target.value)} />
        </label>
        <p className="muted small">
          Google doesn&apos;t let apps read the remaining quota, so enter your limit to see what&apos;s left. Find it at{" "}
          <a href="https://aistudio.google.com/rate-limit" target="_blank" rel="noreferrer">AI Studio → Rate limits</a>. Counted by this app since{" "}
          {usage.since ? new Date(usage.since).toLocaleDateString("en-IN") : "today"}; official numbers are at{" "}
          <a href="https://aistudio.google.com/usage" target="_blank" rel="noreferrer">AI Studio → Usage</a>.
        </p>
      </div>
    </div>
  );
}
