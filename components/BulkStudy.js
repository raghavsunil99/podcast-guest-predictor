"use client";

// Bulk study: queue many LinkedIn PDFs, profile links or pasted profiles and study them one after
// another. The queue lives outside React, so it keeps running when you switch to another page.
import { useMemo, useState, useSyncExternalStore } from "react";
import Icon from "./icons";
import GuestPhoto from "./GuestPhoto";
import { CompanyName, Segmented, StageBadge, fmtDate } from "./ui";
import { BackgroundPanel, MessagesPanel, PredictionPanel } from "./Insight";
import { studyOne } from "./studyOne";
import { normLinkedIn, normName } from "@/lib/crm";

const GAP_MS = 1500; // pause between profiles, to stay friendly with AI rate limits

// ---------- queue store ----------
let state = { items: [], running: false, paused: "", mode: "step", current: null, saved: 0 };
const listeners = new Set();
const set = (patch) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
const update = (id, patch) => set({ items: state.items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
let seq = 0;
const newId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

export function useBulk() {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state, () => state);
}

// "Vishnu Vardhan Reddy Chaparapu _ LinkedIn.pdf" → "Vishnu Vardhan Reddy Chaparapu"
const nameFromFile = (n) => n.replace(/\.pdf$/i, "").replace(/\s*[_|-]\s*linkedin\s*$/i, "").trim();
const nameFromText = (t) => (t.split("\n").map((x) => x.trim()).find((x) => x && x.length < 60 && !/linkedin|notification|messaging|home|jobs/i.test(x)) || "Pasted profile");

const tokens = (n) => normName(n).split(" ").filter((w) => w.length > 1);
// Same person? Exact name, or every word of the shorter name appears in the longer one
// ("Vishnu Chaparapu" vs "Vishnu Vardhan Reddy Chaparapu"), needing at least two words.
function nameMatch(a, b) {
  const A = tokens(a), B = tokens(b);
  if (A.length < 2 || B.length < 2) return null;
  if (A.join(" ") === B.join(" ")) return "exact";
  const [short, long] = A.length <= B.length ? [A, B] : [B, A];
  return short.every((w) => long.includes(w)) ? "possible" : null;
}

// Look for this profile among saved guests before spending an AI request on it.
function findExisting(item, guests) {
  if (item.url) {
    const k = normLinkedIn(item.url);
    const g = k && guests.find((x) => normLinkedIn(x.linkedinUrl) === k);
    if (g) return { g, how: "Same LinkedIn link" };
  }
  let possible = null;
  for (const g of guests) {
    const m = nameMatch(item.label, g.name);
    if (m === "exact") return { g, how: "Same name" };
    if (m === "possible" && !possible) possible = { g, how: "Similar name" };
  }
  return possible;
}

function add(items, guests) {
  const queued = state.items;
  const fresh = [];
  let dupes = 0;
  for (const it of items) {
    // Duplicate inside this batch (same file, link or name already queued)?
    const twin = [...queued, ...fresh].find((q) =>
      (it.file && q.file && q.file.name === it.file.name && q.file.size === it.file.size) ||
      (it.url && q.url && normLinkedIn(it.url) === normLinkedIn(q.url)) ||
      nameMatch(it.label, q.label) === "exact");
    if (twin) { dupes++; fresh.push({ id: newId(), status: "dupBatch", dupOf: twin.label, ...it }); continue; }
    const hit = findExisting(it, guests);
    if (hit) dupes++;
    fresh.push({ id: newId(), status: hit ? "exists" : "waiting", guestId: hit?.g.id || null, dupHow: hit?.how || "", ...it });
  }
  set({ items: [...queued, ...fresh], saved: (state.saved || 0) + dupes });
}

// Study exactly one queued profile (one-by-one mode).
async function studyItem(it, ctx) {
  set({ running: true, current: it.id, paused: "" });
  update(it.id, { status: "studying", error: "" });
  try {
    const r = await studyOne({
      inp: { url: it.url || "", profileText: it.text || "", pdf: it.file || null, extra: ctx.extra, honorific: ctx.honorific },
      settings: ctx.settings, providerId: ctx.providerId, nativeGreeting: ctx.nativeGreeting, api: ctx.api,
    });
    update(it.id, { status: "done", guestId: r.guest?.id || null, duplicate: r.duplicate, label: r.result.profile?.fullName || it.label });
    if (r.notice) ctx.flash?.(r.notice);
  } catch (err) {
    if (err.code === "offline") {
      // Not this profile's fault: keep it waiting and tell you to start the app.
      update(it.id, { status: "waiting", error: "" });
      set({ paused: "Paused: " + err.message });
    } else update(it.id, { status: "failed", error: err.message });
  } finally {
    set({ running: false });
    ctx.onUsageChange?.();
  }
}

async function run(ctx) {
  if (state.running) return;
  set({ items: state.items.map((x) => (x.status === "failed" && /load failed|failed to fetch|can't reach the app/i.test(x.error || "") ? { ...x, status: "waiting", error: "" } : x)) });
  set({ running: true, paused: "" });
  let busyInARow = 0;
  try {
    for (;;) {
      if (state.paused) break;
      const it = state.items.find((x) => x.status === "waiting");
      if (!it) break;
      update(it.id, { status: "studying", error: "" });
      try {
        const r = await studyOne({
          inp: { url: it.url || "", profileText: it.text || "", pdf: it.file || null, extra: ctx.extra, honorific: ctx.honorific },
          settings: ctx.settings, providerId: ctx.providerId, nativeGreeting: ctx.nativeGreeting, api: ctx.api,
        });
        busyInARow = 0;
        update(it.id, {
          status: "done", guestId: r.guest?.id || null, duplicate: r.duplicate,
          label: r.result.profile?.fullName || it.label,
        });
        if (r.notice) ctx.flash?.(r.notice);
      } catch (err) {
        if (err.code === "offline") {
          update(it.id, { status: "waiting", error: "" });
          set({ paused: "Paused: " + err.message });
          break;
        }
        update(it.id, { status: "failed", error: err.message });
        // A rejected key or no usable provider won't fix itself: stop and say so.
        if (err.code === "auth" || err.code === "none") { set({ paused: "Paused: " + err.message }); break; }
        // Every provider busy twice in a row: wait a minute instead of burning through the list.
        if (err.code === "exhausted" && ++busyInARow >= 2) { set({ paused: "Paused: every AI provider is busy. Resume in a minute." }); break; }
      } finally {
        ctx.onUsageChange?.();
      }
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  } finally {
    set({ running: false });
  }
}

// ---------- UI ----------
const STATUS = {
  waiting: ["Waiting", "clock"],
  studying: ["Studying…", "sparkle"],
  done: ["Done", "check"],
  failed: ["Failed", "x"],
  exists: ["Already in guests", "users"],
  dupBatch: ["Duplicate in this batch", "copy"],
  skipped: ["Skipped", "x"],
};

export default function BulkStudy({ settings, api, guests, providers = [], flash, onUsageChange }) {
  const q = useBulk();
  const [urls, setUrls] = useState("");
  const [paste, setPaste] = useState("");
  const [providerId, setProviderId] = useState("");
  const [nativeGreeting, setNativeGreeting] = useState(false);
  const [over, setOver] = useState(false);
  const [minScore, setMinScore] = useState(70);
  const ctx = { settings, api, flash, onUsageChange, providerId, nativeGreeting, extra: "", honorific: "auto" };

  const byId = useMemo(() => new Map(guests.map((g) => [g.id, g])), [guests]);
  const counts = q.items.reduce((m, it) => ((m[it.status] = (m[it.status] || 0) + 1), m), {});
  const toDo = (counts.waiting || 0) + (counts.studying || 0);
  const finished = q.items.filter((it) => it.status === "done");
  const total = q.items.filter((it) => !["exists", "dupBatch", "skipped"].includes(it.status)).length;
  const dupCount = (counts.exists || 0) + (counts.dupBatch || 0);
  const nextUp = q.items.find((it) => it.status === "waiting");
  const cur = q.current ? q.items.find((it) => it.id === q.current) : null;

  const addFiles = (files) => {
    const pdfs = [...(files || [])].filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (pdfs.length) add(pdfs.map((f) => ({ kind: "pdf", file: f, label: nameFromFile(f.name) })), guests);
  };
  const addUrls = () => {
    const found = [...new Set((urls.match(/(https?:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/in\/[^\s,;"'<>)]+/gi) || []).map((u) => (u.startsWith("http") ? u : `https://${u}`)))];
    if (!found.length) return flash?.("No LinkedIn profile links found (they look like linkedin.com/in/name)");
    add(found.map((u) => ({ kind: "url", url: u, label: normLinkedIn(u).replace(/-[0-9a-f]{6,}$/i, "").replace(/-/g, " ") || u })), guests);
    setUrls("");
  };
  const addPaste = () => {
    if (paste.trim().length < 80) return flash?.("Paste the whole profile (⌘A, ⌘C on the LinkedIn page)");
    const url = (paste.match(/linkedin\.com\/in\/[^\s,;"'<>)]+/i) || [])[0];
    add([{ kind: "text", text: paste, url: url ? `https://www.${url}` : "", label: nameFromText(paste) }], guests);
    setPaste("");
  };

  // Each queued profile is one AI request; warn before a big batch.
  const pending = counts.waiting || 0;

  return (
    <div className="bulk">
      <section className="card bulkAdd">
        <div className="cardHead">
          <div>
            <h2>Bulk study</h2>
            <p className="muted small">Queue many profiles and study them one after another. Each is saved to your guests, like a single study. It keeps going if you switch pages.</p>
          </div>
        </div>

        <label
          className={`bulkDrop${over ? " over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
        >
          <input type="file" accept="application/pdf" multiple onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <Icon name="upload" size={22} />
          <strong>Drop LinkedIn PDFs here, or click to choose</strong>
          <small>Select as many as you like (best results, includes the photo)</small>
        </label>

        <details className="bulkMore">
          <summary>Or add profile links</summary>
          <textarea rows={4} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder={"linkedin.com/in/name-one\nlinkedin.com/in/name-two\n…one per line, or paste a whole list"} />
          <p className="muted tiny">With only a link, the AI researches the public profile on the web, so details can be thinner than a PDF.</p>
          <button type="button" className="btn btnSm" onClick={addUrls}><Icon name="plus" size={13} />Add links to queue</button>
        </details>

        <details className="bulkMore">
          <summary>Or paste profiles one by one</summary>
          <textarea rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="On the LinkedIn page press ⌘A, ⌘C, then paste here and click Add. Repeat for the next profile." />
          <button type="button" className="btn btnSm" onClick={addPaste}><Icon name="plus" size={13} />Add to queue</button>
        </details>

        <div className="row gap12 wrap">
          {providers.length > 0 && (
            <label className="field grow">
              <span>AI provider</span>
              <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
                <option value="">Automatic (switches on rate limits)</option>
                {providers.filter((p) => p.enabled && p.hasKey).map((p) => <option key={p.id} value={p.id}>Only {p.name} · {p.model}</option>)}
              </select>
            </label>
          )}
        </div>
        <label className="switch">
          <input type="checkbox" checked={nativeGreeting} onChange={(e) => setNativeGreeting(e.target.checked)} />
          <span className="switchTrack" aria-hidden />
          <span>Greet in their native language <em>Vanakkam, Namaskaram, Namaste…</em></span>
        </label>
      </section>

      <section className="card bulkQueue">
        <div className="bulkBar">
          <div className="grow">
            <h3>Queue</h3>
            <p className="muted small">
              {q.items.length === 0 ? "Nothing queued yet." : `${finished.length} of ${total} studied${counts.failed ? ` · ${counts.failed} failed` : ""}`}
              {pending > 0 && !q.running && ` · ${pending} AI request${pending > 1 ? "s" : ""} to go`}
            </p>
          </div>
          <Segmented value={q.mode} onChange={(m) => set({ mode: m })} options={[{ value: "step", label: "One by one" }, { value: "auto", label: "All automatically" }]} />
        </div>

        {dupCount > 0 && (
          <div className="dupSaved">
            <Icon name="users" size={15} />
            <span><strong>{dupCount} duplicate{dupCount > 1 ? "s" : ""} found</strong>, {dupCount > 1 ? "they" : "it"} won&apos;t be studied again, saving {dupCount} AI credit{dupCount > 1 ? "s" : ""}. Click ↻ on one to study it anyway.</span>
          </div>
        )}

        {q.mode === "step" ? (
          <div className="stepBar">
            <span className="muted small grow">{nextUp ? `Next: ${nextUp.label}` : finished.length ? "All queued profiles are done." : ""}</span>
            {cur && cur.status === "studying" ? (
              <button className="btn btnPrimary" disabled><span className="btnSpinner" aria-hidden />Studying…</button>
            ) : (
              <button className="btn btnPrimary" disabled={!nextUp || q.running} onClick={() => studyItem(nextUp, ctx)}>
                {finished.length || counts.failed ? <>Next profile<Icon name="arrowRight" size={15} /></> : <><Icon name="sparkle" size={15} />Study first profile</>}
                {pending ? <span className="stepLeft">{pending} left</span> : null}
              </button>
            )}
          </div>
        ) : (
          <div className="stepBar">
            <span className="muted small grow">Studies every profile in a row, about 15–25 seconds each.</span>
            {q.running ? (
              <button className="btn" onClick={() => set({ paused: "Paused" })}><Icon name="clock" size={14} />Pause</button>
            ) : (
              <button className="btn btnPrimary" disabled={!pending} onClick={() => run(ctx)}>
                <Icon name="sparkle" size={15} />{finished.length || counts.failed ? "Resume" : "Start studying"}{pending ? ` (${pending})` : ""}
              </button>
            )}
          </div>
        )}

        {total > 0 && (
          <div className="meter bulkMeter"><div style={{ width: `${Math.round((finished.length / Math.max(1, total)) * 100)}%` }} /></div>
        )}

        {q.mode === "step" && cur && <StepView it={cur} g={cur.guestId ? byId.get(cur.guestId) : null} api={api} onRetry={() => studyItem(cur, ctx)} />}

        {q.paused && q.paused !== "Paused" && <div className="alert alertWarn">{q.paused}</div>}

        {q.items.length > 0 && (
          <ul className="bulkList">
            {q.items.map((it) => {
              const g = it.guestId ? byId.get(it.guestId) : null;
              const [label, icon] = STATUS[it.status];
              return (
                <li key={it.id} className={`bulkItem st-${it.status}${q.current === it.id ? " cur" : ""}`} onClick={() => it.status === "done" && set({ current: it.id })}>
                  {g ? <GuestPhoto g={g} size={34} /> : <span className="bulkKind"><Icon name={it.kind === "pdf" ? "note" : it.kind === "url" ? "linkedin" : "copy"} size={15} /></span>}
                  <div className="grow bulkMain">
                    <strong className="ellipsis">{g?.name || it.label}</strong>
                    {g ? (
                      <span className="row gap6 wrap"><CompanyName name={g.company} domain={g.companyDomain} size={13} /><StageBadge stage={g.stage} /></span>
                    ) : (
                      <span className="muted tiny ellipsis">{it.status === "failed" ? it.error : it.status === "dupBatch" ? `Same as ${it.dupOf} above` : it.kind === "pdf" ? it.file?.name : it.url || "Pasted profile"}</span>
                    )}
                    {it.status === "exists" && g && <span className="muted tiny">{it.dupHow} · saved {fmtDate(g.createdAt)}</span>}
                  </div>
                  {g && typeof g.score === "number" && it.status === "done" && <span className={`bulkScore ${g.score >= 65 ? "hi" : g.score >= 45 ? "mid" : "lo"}`}>{g.score}</span>}
                  <span className={`bulkStatus s-${it.status}`}>
                    {it.status === "studying" ? <span className="btnSpinner" aria-hidden /> : <Icon name={icon} size={12} />}
                    {it.status === "done" && it.duplicate ? "Updated" : label}
                  </span>
                  <span className="bulkActs" onClick={(e) => e.stopPropagation()}>
                    {g && <button className="iconBtn sm" title="Open guest" onClick={() => api.open(g.id)}><Icon name="arrowRight" size={13} /></button>}
                    {g && it.status === "done" && g.stage === "Discovered" && (
                      <button className="iconBtn sm" title="Shortlist" onClick={() => api.patch(g.id, { stage: "Shortlisted" })}><Icon name="thumbUp" size={13} /></button>
                    )}
                    {["failed", "exists", "dupBatch", "skipped"].includes(it.status) && (
                      <button className="iconBtn sm" title={it.status === "failed" ? "Try again" : "Study anyway (uses 1 AI credit)"} onClick={() => update(it.id, { status: "waiting", error: "" })}><Icon name="refresh" size={13} /></button>
                    )}
                    {it.status === "waiting" && q.mode === "step" && (
                      <button className="iconBtn sm" title="Skip this profile" onClick={(e) => { e.stopPropagation(); update(it.id, { status: "skipped" }); }}><Icon name="arrowDown" size={13} /></button>
                    )}
                    {it.status !== "studying" && (
                      <button className="iconBtn sm" title="Remove from queue" onClick={() => set({ items: state.items.filter((x) => x.id !== it.id) })}><Icon name="x" size={13} /></button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {finished.length > 0 && !q.running && (
          <div className="bulkAfter">
            <span className="muted small">Shortlist everyone scoring</span>
            <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
              {[80, 70, 65, 60, 50].map((n) => <option key={n} value={n}>{n}+</option>)}
            </select>
            <button className="btn btnSm" onClick={async () => {
              const pick = finished.map((it) => byId.get(it.guestId)).filter((g) => g && g.stage === "Discovered" && (g.score ?? 0) >= minScore);
              for (const g of pick) await api.patch(g.id, { stage: "Shortlisted" });
              flash?.(pick.length ? `Shortlisted ${pick.length} guest${pick.length > 1 ? "s" : ""}` : "No new guests at that score");
            }}><Icon name="thumbUp" size={13} />Shortlist</button>
            <span className="push" />
            <button className="linkBtn small" onClick={() => set({ items: state.items.filter((x) => !["done", "exists", "dupBatch", "skipped"].includes(x.status)), current: null })}>Clear finished</button>
          </div>
        )}
      </section>
    </div>
  );
}

// The profile being reviewed in one-by-one mode: prediction, language and ready-to-copy messages.
function StepView({ it, g, api, onRetry }) {
  if (it.status === "studying") {
    return <div className="card stepView stepBusy"><span className="btnSpinner" aria-hidden /><span>Studying <strong>{it.label}</strong>… usually 15–25 seconds</span></div>;
  }
  if (it.status === "failed") {
    return (
      <div className="card stepView">
        <div className="alert alertError">{it.label}: {it.error}</div>
        <button className="btn btnSm" onClick={onRetry}><Icon name="refresh" size={13} />Try again</button>
      </div>
    );
  }
  if (!g?.result) return null;
  const r = g.result;
  const patchResult = (next) => api.patch(g.id, { patch: { result: next, ...(next.background ? { language: next.background.nativeLanguage === "Unknown" ? "" : next.background.nativeLanguage } : {}) } });
  return (
    <div className="stepView stack12 fadeIn">
      <div className="card stepHead">
        <GuestPhoto g={g} size={52} ring />
        <div className="grow">
          <h3>{g.name}</h3>
          <p className="muted small">{g.role}</p>
          <CompanyName name={g.company} domain={g.companyDomain} />
        </div>
        <div className="row gap6 wrap">
          {it.duplicate && <span className="dupTag">Updated existing guest</span>}
          <StageBadge stage={g.stage} />
          {g.stage === "Discovered" && <button className="btn btnSm" onClick={() => api.patch(g.id, { stage: "Shortlisted" })}><Icon name="thumbUp" size={13} />Shortlist</button>}
          <button className="btn btnSm" onClick={() => api.open(g.id)}>Open<Icon name="arrowRight" size={13} /></button>
        </div>
      </div>
      <PredictionPanel acc={r.acceptance} ss={r.socialSignals} learning={g.learning} onOpenGuest={api.open} />
      {r.hook && <div className="hookCard"><span className="eyebrow">The hook</span><p>{r.hook}</p></div>}
      <BackgroundPanel result={r} onLanguage={patchResult} />
      <div className="card">
        <MessagesPanel result={r} onEdit={(field, value) => patchResult({ ...r, [field]: value })} linkedinUrl={g.linkedinUrl} />
      </div>
    </div>
  );
}

// Small badge for the sidebar: "3/10" while a batch is running.
export function BulkBadge() {
  const q = useBulk();
  const total = q.items.filter((it) => !["exists", "dupBatch", "skipped"].includes(it.status)).length;
  const done = q.items.filter((it) => it.status === "done" || it.status === "failed").length;
  if (!q.running || !total) return null;
  return <span className="navCount" title="Bulk study in progress">{done}/{total}</span>;
}
