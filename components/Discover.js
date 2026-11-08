"use client";

// Study a LinkedIn profile → prediction, regional background and invitation. Every result is
// saved to the pipeline automatically (duplicates are merged with the existing guest).
import { useEffect, useRef, useState } from "react";
import Icon from "./icons";
import GuestPhoto from "./GuestPhoto";
import { Avatar, CompanyName, StageBadge } from "./ui";
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
  const fileRef = useRef(null);
  const saveTimer = useRef(null);

  const guest = saved ? guests.find((g) => g.id === saved.id) : null;

  async function generate(e) {
    e?.preventDefault();
    setError("");
    setErrorInfo(null);
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
      if (providerId) fd.append("provider", providerId);
      if (pdf) fd.append("pdf", pdf);
      const res = await fetch("/api/generate", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({ error: "Unexpected server response." }));
      if (!res.ok || data.error) {
        setErrorInfo({ code: data.code, providerId: data.providerId });
        throw new Error(data.error || "Something went wrong.");
      }
      const { pdfPhoto, ...clean } = data;
      setResult(clean);
      if (data.ai?.notice) flash?.(data.ai.notice);
      const out = await api.save(clean, url.trim());
      setSaved(out ? { id: out.guest.id, duplicate: out.duplicate } : null);
      // Profile photo found inside the PDF: use it unless you've already set a photo for this guest.
      if (out && pdfPhoto && !out.guest.photoUrl) {
        await api.patch(out.guest.id, { patch: { photoUrl: pdfPhoto } });
        flash?.("Profile photo added from the PDF");
      }
    } catch (err) {
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

  return (
    <div className="discover">
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
          <input ref={fileRef} type="file" accept="application/pdf" onChange={(e) => setPdf(e.target.files?.[0] || null)} />
          <Icon name={pdf ? "check" : "upload"} size={18} />
          <span>
            <strong>{pdf ? pdf.name : "Or upload the profile PDF"}</strong>
            <small>{pdf ? "Ready to study" : "Open their LinkedIn page → ⌘P → Save as PDF (includes photo)"}</small>
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
            {loading ? "Studying profile…" : result ? "Study again" : "Study profile"}
          </button>
          <button type="button" className="btn btnLg" onClick={clearInputs} disabled={loading}>Clear</button>
        </div>
      </form>

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
  );
}
