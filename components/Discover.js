"use client";

// Study a LinkedIn profile → prediction, regional background and invitation. Every result is
// saved to the pipeline automatically (duplicates are merged with the existing guest).
import { useEffect, useRef, useState } from "react";
import Icon from "./icons";
import { studyOne } from "./studyOne";
import BulkStudy from "./BulkStudy";
import GuestPhoto from "./GuestPhoto";
import { Avatar, CompanyName, Segmented, StageBadge } from "./ui";
import { BackgroundPanel, CareerTimeline, MessagesPanel, PredictionPanel, ProfileSummary } from "./Insight";

export default function Discover({ settings, api, guests, onUsageChange, providers = [], flash, openProviders }) {
  const [url, setUrl] = useState("");
  const [profileText, setProfileText] = useState("");
  const [pdf, setPdf] = useState(null);
  const [honorific, setHonorific] = useState("auto");
  const [extra, setExtra] = useState("");
  const [nativeGreeting, setNativeGreeting] = useState(false);
  const [providerId, setProviderId] = useState(""); // "" = automatic, by priority with fallback
  const [errorInfo, setErrorInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(null); // { id, duplicate }
  const [done, setDone] = useState(false); // last study finished: show next steps instead of the old inputs
  const [dragOver, setDragOver] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [mode, setMode] = useState("one");
  // Remembered choice is read in the browser only (the server render has no saved choice).
  useEffect(() => { try { const m = localStorage.getItem("epi.discoverMode"); if (m) setMode(m); } catch {} }, []);
  const pickMode = (m) => { setMode(m); try { localStorage.setItem("epi.discoverMode", m); } catch {} }; // empty form for the next guest (the last result is still shown)
  const fileRef = useRef(null);
  const saveTimer = useRef(null);

  const guest = saved ? guests.find((g) => g.id === saved.id) : null;

  async function generate(e, next) {
    e?.preventDefault?.();
    const inp = next || { url, profileText, pdf, extra, honorific };
    setError("");
    setErrorInfo(null);
    if (!inp.url.trim() && !inp.profileText.trim() && !inp.pdf) {
      setError("Add a LinkedIn URL, paste the profile text, or upload the profile PDF.");
      return;
    }
    setLoading(true);
    try {
      const r = await studyOne({ inp, settings, providerId, nativeGreeting, api });
      setResult(r.result);
      if (r.notice) flash?.(r.notice);
      setFresh(false);
      setDone(true); // show the "what next" panel instead of the filled-in form
      setSaved(r.guest ? { id: r.guest.id, duplicate: r.duplicate } : null);
      if (r.photoAdded) flash?.("Profile photo added from the PDF");
    } catch (err) {
      if (err.code) setErrorInfo({ code: err.code, providerId: err.providerId });
      setError(err.message);
    } finally {
      setLoading(false);
      onUsageChange?.();
    }
  }

  function editMessage(field, value) {
    const next = { ...result, [field]: value };
    setResult(next);
    if (!saved) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => api.patch(saved.id, { patch: { result: next } }), 700);
  }
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // Start fresh for the next guest (the last result stays visible on the right until then).
  function studyNext(file) {
    clearInputs();
    setDone(false);
    setFresh(true);
    setError("");
    if (file) {
      setPdf(file);
      generate(null, { url: "", profileText: "", pdf: file, extra: "", honorific: "auto" });
    }
  }
  const pdfFrom = (list) => [...(list || [])].find((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));

  function clearInputs() {
    setUrl("");
    setProfileText("");
    setPdf(null);
    setExtra("");
    setHonorific("auto");
    if (fileRef.current) fileRef.current.value = "";
  }

  const p = result?.profile;
  const contact = result?.contact || {};
  const hasContact = contact.email || contact.phone || contact.website;

  const modeSwitch = (
    <div className="discoverMode">
      <Segmented value={mode} onChange={pickMode} options={[{ value: "one", label: "One profile" }, { value: "bulk", label: "Bulk study" }]} />
    </div>
  );
  if (mode === "bulk") {
    return (
      <div className="stack16">
        {modeSwitch}
        <BulkStudy settings={settings} api={api} guests={guests} providers={providers} flash={flash} onUsageChange={onUsageChange} />
      </div>
    );
  }

  return (
    <div className="stack16">
    {modeSwitch}
    <div className="discover">
      {done && result && !loading ? (
        <div
          className={`card discoverForm doneCard${dragOver ? " over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = pdfFrom(e.dataTransfer.files); if (f) studyNext(f); }}
        >
          <div className="doneHead">
            <span className="doneTick"><Icon name="check" size={18} /></span>
            <div className="grow">
              <h2>{result.profile?.fullName || "Profile"} studied</h2>
              <p className="muted small">
                {saved?.duplicate ? "Already in your guests, so their record was updated" : "Saved to your guests as Discovered"}
                {typeof guest?.score === "number" ? ` · prediction ${guest.score}/100` : ""}
              </p>
            </div>
          </div>

          <div className="doneActions">
            {guest && guest.stage === "Discovered" && (
              <button type="button" className="btn" onClick={() => api.patch(guest.id, { stage: "Shortlisted" })}><Icon name="thumbUp" size={15} />Shortlist</button>
            )}
            {guest && <button type="button" className="btn" onClick={() => api.open(guest.id)}><Icon name="users" size={15} />Open guest</button>}
            <button type="button" className="btn" onClick={() => { setDone(false); generate(); }}><Icon name="refresh" size={15} />Study again</button>
          </div>

          <label className="nextDrop">
            <input type="file" accept="application/pdf" onChange={(e) => { const f = pdfFrom(e.target.files); e.target.value = ""; if (f) studyNext(f); }} />
            <Icon name="upload" size={22} />
            <strong>Drop the next profile PDF here</strong>
            <small>It starts studying straight away, with the same settings</small>
          </label>

          <button type="button" className="btn btnPrimary btnLg" onClick={() => studyNext()}>
            <Icon name="plus" size={17} />Study next profile (paste URL or text)
          </button>
          <button type="button" className="linkBtn small doneEdit" onClick={() => setDone(false)}>Change this profile&apos;s inputs</button>
        </div>
      ) : (
      <form className="card discoverForm" onSubmit={generate}>
        <div className="cardHead">
          <div>
            <h2>Study a profile</h2>
            <p className="muted small">Predict acceptance, detect regional background, and draft the invite.</p>
          </div>
        </div>

        <label className="field">
          <span>LinkedIn profile URL</span>
          <div className="inputIcon">
            <Icon name="linkedin" size={16} />
            <input type="url" placeholder="linkedin.com/in/username" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
        </label>

        <label className="field">
          <span>Profile text <em>recommended</em></span>
          <textarea
            rows={8}
            placeholder="Open the profile, select all (⌘A), copy and paste here. Include the follower count, Activity and Contact info for the best results."
            value={profileText}
            onChange={(e) => setProfileText(e.target.value)}
          />
        </label>

        <label className={`dropzone${pdf ? " hasFile" : ""}`}>
          <input ref={fileRef} type="file" accept="application/pdf" onChange={(e) => setPdf(pdfFrom(e.target.files) || null)} />
          <Icon name={pdf ? "check" : "upload"} size={18} />
          <span>
            <strong>{pdf ? pdf.name : "Or upload the profile PDF"}</strong>
            <small>{pdf ? "Ready to study · drop another PDF to replace it" : "Open their LinkedIn page → ⌘P → Save as PDF (includes photo)"}</small>
          </span>
        </label>

        <div className="row gap12 wrap">
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
            <span>Extra notes <em>optional</em></span>
            <input placeholder="e.g. mention their recent post on AI" value={extra} onChange={(e) => setExtra(e.target.value)} />
          </label>
        </div>

        {providers.length > 0 && (
          <label className="field">
            <span>AI provider</span>
            <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">Automatic (by priority, switches on rate limits)</option>
              {providers.filter((p) => p.enabled && p.hasKey).map((p) => (
                <option key={p.id} value={p.id}>Only {p.name} · {p.model}</option>
              ))}
            </select>
          </label>
        )}

        <label className="switch">
          <input type="checkbox" checked={nativeGreeting} onChange={(e) => setNativeGreeting(e.target.checked)} />
          <span className="switchTrack" aria-hidden />
          <span>Greet in their native language <em>Vanakkam, Namaskaram, Namaste…</em></span>
        </label>

        {error && (
          <div className="alert alertError" role="alert">
            {error}
            {(errorInfo?.code === "auth" || errorInfo?.code === "none") && (
              <div className="row gap8 wrap" style={{ marginTop: 8 }}>
                <button type="button" className="btn btnSm" onClick={openProviders}><Icon name="key" size={13} />Open AI providers</button>
                {providers.filter((p) => p.enabled && p.hasKey && p.id !== errorInfo.providerId).slice(0, 2).map((p) => (
                  <button type="button" key={p.id} className="btn btnSm" onClick={() => { setProviderId(p.id); setError(""); setErrorInfo(null); }}>
                    Use {p.name} instead
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="row gap8">
          <button type="submit" className="btn btnPrimary btnLg grow" disabled={loading}>
            {loading ? <span className="btnSpinner" aria-hidden /> : <Icon name="discover" size={17} />}
            {loading ? "Studying profile…" : result && !fresh ? "Study again" : "Study profile"}
          </button>
          <button type="button" className="btn btnLg" onClick={clearInputs} disabled={loading}>Clear</button>
        </div>
      </form>
      )}

      <section className="discoverResult">
        {!result && !loading && (
          <div className="card discoverEmpty">
            <div className="orbit" aria-hidden>
              <span /><span /><span />
              <Icon name="archive" size={26} />
            </div>
            <h3>Find your next great guest</h3>
            <p>Paste a LinkedIn profile to see how likely they are to say yes, where they&apos;re from, and a personal invitation ready to send. Every guest is saved to your pipeline.</p>
            <ul className="steps">
              <li><span>1</span>Paste profile</li>
              <li><span>2</span>Review prediction</li>
              <li><span>3</span>Send the invite</li>
            </ul>
          </div>
        )}

        {loading && (
          <div className="card discoverEmpty">
            <div className="skeletonStack" aria-hidden>
              <div className="sk skCircle" />
              <div className="sk skLine" />
              <div className="sk skLine short" />
            </div>
            <h3>Studying the profile…</h3>
            <p>Scoring audience, activity and story, guessing regional background, and drafting the invite.</p>
          </div>
        )}

        {result && !loading && (
          <div className="stack16 fadeIn">
            <div className="card">
              <div className="guestHead">
                {guest ? <GuestPhoto g={guest} size={56} ring /> : <Avatar name={p?.fullName} size={56} ring />}
                <div className="guestHeadText">
                  <h2>{p?.fullName}</h2>
                  <p className="muted">{p?.currentRole}</p>
                  <div className="metaRow">
                    <CompanyName name={p?.currentCompany} domain={guest?.companyDomain || p?.companyDomain} />
                    {p?.currentCity && p.currentCity !== "Unknown" && <span className="metaItem">{p.currentCity}</span>}
                    {p?.totalExperience && p.totalExperience !== "Unknown" && <span className="metaItem">{p.totalExperience}</span>}
                  </div>
                </div>
              </div>
              {saved && (
                <div className={`savedBar${saved.duplicate ? " dup" : ""}`}>
                  <Icon name={saved.duplicate ? "users" : "check"} size={16} />
                  <span>
                    {saved.duplicate
                      ? "Already in your pipeline. Their profile and prediction were refreshed, notes and contacts kept."
                      : "Saved to your pipeline."}
                  </span>
                  {guest && <StageBadge stage={guest.stage} />}
                  <button className="btn btnSm push" onClick={() => api.open(saved.id)}>
                    Open guest <Icon name="arrowRight" size={14} />
                  </button>
                </div>
              )}
              {hasContact && (
                <div className="contactFound">
                  <span className="eyebrow">Contact found in profile</span>
                  {contact.email && <a href={`mailto:${contact.email}`}><Icon name="mail" size={14} />{contact.email}</a>}
                  {contact.phone && <a href={`tel:${contact.phone}`}><Icon name="phone" size={14} />{contact.phone}</a>}
                  {contact.website && <a href={/^https?:/.test(contact.website) ? contact.website : `https://${contact.website}`} target="_blank" rel="noreferrer"><Icon name="globe" size={14} />{contact.website}</a>}
                </div>
              )}
            </div>

            <PredictionPanel
              acc={result.acceptance}
              ss={result.socialSignals}
              learning={guest?.learning}
              onOpenGuest={api.open}
              onSaveSignals={saved && (async (signals) => {
                const ng = await api.patch(saved.id, { signals });
                if (ng?.result) setResult(ng.result);
              })}
            />

            {result.hook && (
              <div className="hookCard">
                <span className="eyebrow">The hook</span>
                <p>{result.hook}</p>
              </div>
            )}

            <CareerTimeline profile={result.profile} />
            <BackgroundPanel result={result} />

            {result.warnings?.length > 0 && (
              <div className="alert alertWarn">
                <strong>Check before sending</strong>
                <ul>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            )}

            <div className="card">
              <MessagesPanel
                result={result}
                onEdit={editMessage}
                linkedinUrl={url || guest?.linkedinUrl}
              />
            </div>

            <ProfileSummary result={result} />
          </div>
        )}
      </section>
    </div>
    </div>
  );
}
