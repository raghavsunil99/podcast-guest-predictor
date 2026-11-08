"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./icons";
import EpisodeForm from "./EpisodeForm";
import { resizePhoto } from "./GuestPhoto";
import { Avatar, CompanyName, Drawer, ScoreRing, StageBadge, TierBadge, fmtDate, timeAgo } from "./ui";
import { BackgroundPanel, CareerTimeline, MessagesPanel, PredictionPanel, ProfileSummary } from "./Insight";
import { SIDE_STAGES, STAGES, STAGE_HINT, daysSince, reached } from "@/lib/crm";

const TABS = ["Overview", "Messages", "Contact", "Notes & history", "Episode"];
const ACT_ICON = { created: "plus", stage: "arrowRight", note: "note", regenerated: "refresh", update: "edit" };


export default function GuestDrawer({ guest: g, api, onClose, settings }) {
  const [tab, setTab] = useState("Overview");
  const [result, setResult] = useState(g.result);
  const timer = useRef(null);
  useEffect(() => setResult(g.result), [g.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(timer.current), []);

  function editMessage(field, value) {
    const next = { ...result, [field]: value };
    setResult(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => api.patch(g.id, { patch: { result: next } }), 700);
  }

  const waiting = g.stage === "Contacted" ? daysSince(g.lastFollowUpAt || g.milestones?.Contacted) : null;
  const due = waiting != null && waiting >= (settings.followUpDays || 5);
  const onSide = SIDE_STAGES.includes(g.stage);
  const [dropping, setDropping] = useState(false);

  async function setPhotoFromFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    await api.patch(g.id, { patch: { photoUrl: await resizePhoto(file, 256) } });
  }
  // Paste a copied photo (e.g. right-click → Copy image on their LinkedIn profile) anywhere in the drawer.
  useEffect(() => {
    const onPaste = (e) => {
      if (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
      if (item) {
        e.preventDefault();
        setPhotoFromFile(item.getAsFile());
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Drawer onClose={onClose} wide label={`${g.name} details`}>
      <div className="drawerTop">
        <div className="guestHead">
          <label
            className={`photoDrop${dropping ? " over" : ""}`}
            title="Change photo: click, drop an image, or paste a copied photo"
            onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
            onDragLeave={() => setDropping(false)}
            onDrop={(e) => { e.preventDefault(); setDropping(false); setPhotoFromFile(e.dataTransfer.files?.[0]); }}
          >
            <Avatar name={g.name} src={g.photoUrl} alt={g.gravatarUrl} size={60} ring />
            <span className="photoEdit"><Icon name="image" size={13} /></span>
            <input type="file" accept="image/*" hidden onChange={(e) => { setPhotoFromFile(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <div className="guestHeadText">
            <h2>{g.name}</h2>
            <p className="muted">{g.role}</p>
            <div className="metaRow">
              <CompanyName name={g.company} domain={g.companyDomain} />
              {g.city && <span className="metaItem">{g.city}</span>}
              {g.language && <span className="metaItem">{g.language}</span>}
            </div>
          </div>
          {g.linkedinUrl && (
            <a className="iconBtn liBtn" href={g.linkedinUrl} target="_blank" rel="noreferrer" title="Open LinkedIn profile" aria-label="Open LinkedIn profile">
              <Icon name="linkedin" size={18} />
            </a>
          )}
          <div className="drawerScore">
            <ScoreRing score={g.score} likelihood={g.likelihood} size={64} stroke={6} />
          </div>
          <button className="iconBtn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>

        <div className="stepper" role="group" aria-label="Pipeline stage">
          {STAGES.map((st, i) => {
            const done = !onSide && reached(g, st) && g.stage !== st;
            return (
              <button key={st} className={`step${g.stage === st ? " current" : ""}${done ? " done" : ""}`} onClick={() => api.patch(g.id, { stage: st })} title={STAGE_HINT[st]}>
                <span className="stepDot">{done ? <Icon name="check" size={11} strokeWidth={3} /> : i + 1}</span>
                <span className="stepLabel">{st}</span>
              </button>
            );
          })}
        </div>
        <div className="sideOutcomes">
          <span className="muted tiny">Other outcomes</span>
          {SIDE_STAGES.map((st) => (
            <button key={st} className={`chipBtn${g.stage === st ? " on" : ""} side-${st.replace(/\s+/g, "")}`} onClick={() => api.patch(g.id, { stage: st })} title={STAGE_HINT[st]}>
              {st}
            </button>
          ))}
          <span className="push" />
          <span className="muted tiny">Good suggestion?</span>
          <button className={`iconBtn sm${g.recFeedback === "relevant" ? " on good" : ""}`} title="Relevant guest for the podcast" onClick={() => api.patch(g.id, { patch: { recFeedback: g.recFeedback === "relevant" ? "" : "relevant" } })}><Icon name="thumbUp" size={14} /></button>
          <button className={`iconBtn sm${g.recFeedback === "irrelevant" ? " on bad" : ""}`} title="Not relevant: hide from recommendations" onClick={() => api.patch(g.id, { patch: { recFeedback: g.recFeedback === "irrelevant" ? "" : "irrelevant" } })}><Icon name="thumbDown" size={14} /></button>
        </div>

        {g.stage === "Contacted" && (
          <div className={`followBar${due ? " due" : ""}`}>
            <Icon name="bell" size={16} />
            <span>
              {due ? `No reply for ${waiting} days. Time to follow up.` : `Contacted ${waiting === 0 ? "today" : `${waiting} day${waiting === 1 ? "" : "s"} ago`}.`}
              {g.followUpCount ? ` ${g.followUpCount} follow-up${g.followUpCount > 1 ? "s" : ""} sent.` : ""}
            </span>
            <button className="btn btnSm push" onClick={() => setTab("Messages")}>View follow-up</button>
            <button className="btn btnSm btnPrimary" onClick={() => api.patch(g.id, { followedUp: true })}>
              <Icon name="check" size={14} /> Mark sent
            </button>
          </div>
        )}

        <div className="drawerTabs" role="tablist">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t}
              {t === "Notes & history" && g.notes?.length > 0 && <span className="segCount">{g.notes.length}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="drawerBody">
        {tab === "Overview" && (
          <div className="stack16">
            {result?.acceptance ? <PredictionPanel
                acc={result.acceptance}
                ss={result.socialSignals}
                learning={g.learning}
                onOpenGuest={api.open}
                onSaveSignals={async (signals) => {
                  const ng = await api.patch(g.id, { signals });
                  if (ng?.result) setResult(ng.result);
                }}
              /> : <TierBadge guest={g} />}
            {result?.hook && (
              <div className="hookCard"><span className="eyebrow">The hook</span><p>{result.hook}</p></div>
            )}
            {result && <CareerTimeline profile={result.profile} />}
            {result && <BackgroundPanel result={result} />}
            {result && <ProfileSummary result={result} />}
          </div>
        )}

        {tab === "Messages" &&
          (result ? (
            <MessagesPanel
              result={result}
              onEdit={editMessage}
              linkedinUrl={g.linkedinUrl}
              onCopied={(label) => api.patch(g.id, { logMessage: `Copied ${label.toLowerCase()}` })}
            />
          ) : (
            <p className="muted">No messages saved for this guest.</p>
          ))}

        {tab === "Contact" && <ContactTab g={g} api={api} />}
        {tab === "Notes & history" && <NotesTab g={g} api={api} />}
        {tab === "Episode" && <EpisodeTab g={g} api={api} />}
      </div>

      <div className="drawerFoot">
        <span className="muted small">Added {fmtDate(g.createdAt)} · updated {timeAgo(g.updatedAt)}</span>
        <button
          className="btn btnSm btnDanger push"
          onClick={() => {
            if (confirm(`Remove ${g.name} from your guests? Their notes and history will be deleted too.`)) {
              api.remove(g.id);
              onClose();
            }
          }}
        >
          <Icon name="trash" size={14} /> Remove guest
        </button>
      </div>
    </Drawer>
  );
}

function SourceTag({ src }) {
  if (!src) return null;
  return <span className={`srcTag src-${src}`}>{src === "manual" ? "Added by you" : "From profile"}</span>;
}

function ContactTab({ g, api }) {
  const [c, setC] = useState({ email: "", phone: "", website: "", ...g.contact });
  const ownPhoto = (u) => !u || u.startsWith("data:") || u.startsWith("/api/photos/");
  const [extra, setExtra] = useState({ linkedinUrl: g.linkedinUrl || "", companyDomain: g.companyDomain || "", photoUrl: ownPhoto(g.photoUrl) ? "" : g.photoUrl });
  const [reminder, setReminder] = useState(g.nextFollowUpAt || "");
  const [savedMsg, setSavedMsg] = useState("");
  const fileRef = useRef(null);
  const src = g.contactSource || {};

  async function save() {
    await api.patch(g.id, {
      contact: c,
      patch: {
        linkedinUrl: extra.linkedinUrl.trim(),
        companyDomain: extra.companyDomain.trim(),
        ...(extra.photoUrl.trim() && extra.photoUrl.trim() !== g.photoUrl ? { photoUrl: extra.photoUrl.trim() } : {}),
        ...(reminder !== (g.nextFollowUpAt || "") ? { nextFollowUpAt: reminder } : {}),
      },
    });
    setSavedMsg("Saved");
    setTimeout(() => setSavedMsg(""), 1600);
  }

  return (
    <div className="stack16">
      <div className="panel">
        <div className="eyebrow">Contact details</div>
        <p className="muted small">Details found on the public profile are filled in automatically. Add or correct them once you&apos;re in touch.</p>
        <div className="formGrid">
          <label className="field">
            <span>Email <SourceTag src={src.email} /></span>
            <div className="inputIcon"><Icon name="mail" size={16} /><input type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} placeholder="name@company.com" /></div>
          </label>
          <label className="field">
            <span>Phone <SourceTag src={src.phone} /></span>
            <div className="inputIcon"><Icon name="phone" size={16} /><input type="tel" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} placeholder="+91 …" /></div>
          </label>
          <label className="field">
            <span>Website <SourceTag src={src.website} /></span>
            <div className="inputIcon"><Icon name="globe" size={16} /><input value={c.website} onChange={(e) => setC({ ...c, website: e.target.value })} placeholder="topmate.io/…" /></div>
          </label>
          <label className="field">
            <span>LinkedIn</span>
            <div className="inputIcon"><Icon name="linkedin" size={16} /><input value={extra.linkedinUrl} onChange={(e) => setExtra({ ...extra, linkedinUrl: e.target.value })} placeholder="linkedin.com/in/…" /></div>
          </label>
        </div>
        <div className="quickLinks">
          {c.email && <a className="btn btnSm" href={`mailto:${c.email}`}><Icon name="mail" size={14} />Email</a>}
          {c.phone && <a className="btn btnSm" href={`https://wa.me/${c.phone.replace(/[^\d]/g, "")}`} target="_blank" rel="noreferrer"><Icon name="phone" size={14} />WhatsApp</a>}
          {g.linkedinUrl && <a className="btn btnSm" href={g.linkedinUrl} target="_blank" rel="noreferrer"><Icon name="linkedin" size={14} />LinkedIn</a>}
        </div>
      </div>

      <div className="panel">
        <div className="eyebrow">Photo & company</div>
        <div className="photoRow">
          <Avatar name={g.name} src={g.photoUrl} alt={g.gravatarUrl} size={64} ring />
          <div className="stack8 grow">
            <div className="row gap8 wrap">
              <button className="btn btnSm" onClick={() => fileRef.current?.click()}><Icon name="upload" size={14} />Upload photo</button>
              {g.photoUrl && <button className="btn btnSm" onClick={() => { setExtra((x) => ({ ...x, photoUrl: "" })); api.patch(g.id, { patch: { photoUrl: "" } }); }}>Remove</button>}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) api.patch(g.id, { patch: { photoUrl: await resizePhoto(f, 256) } });
                  e.target.value = "";
                }}
              />
            </div>
            <input value={extra.photoUrl} onChange={(e) => setExtra({ ...extra, photoUrl: e.target.value })} placeholder="…or paste a photo URL" />
            <p className="muted small">
              LinkedIn doesn&apos;t offer an API for other members&apos; photos. On their profile, right-click the photo and choose <b>Copy image</b> then press ⌘V here, or <b>Copy image address</b> and paste the link above. The photo is saved on this computer, so it keeps working after LinkedIn&apos;s link expires. With an email, Gravatar is tried automatically.
            </p>
          </div>
        </div>
        <label className="field">
          <span>Company website <em>used for the logo</em></span>
          <div className="inputIcon"><Icon name="building" size={16} /><input value={extra.companyDomain} onChange={(e) => setExtra({ ...extra, companyDomain: e.target.value })} placeholder="company.com" /></div>
        </label>
      </div>

      <div className="panel">
        <div className="eyebrow">Reminder</div>
        <label className="field">
          <span>Follow up on</span>
          <input type="date" value={reminder} onChange={(e) => setReminder(e.target.value)} />
        </label>
      </div>

      <div className="row gap8">
        <button className="btn btnPrimary" onClick={save}><Icon name="check" size={16} />Save changes</button>
        {savedMsg && <span className="savedFlash">{savedMsg}</span>}
      </div>
    </div>
  );
}

function NotesTab({ g, api }) {
  const [text, setText] = useState("");
  const history = g.activity || [];
  return (
    <div className="stack16">
      <form
        className="noteForm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          api.patch(g.id, { note: text });
          setText("");
        }}
      >
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note: a call summary, what they want to talk about, availability…" />
        <button className="btn btnPrimary btnSm" disabled={!text.trim()}><Icon name="plus" size={14} />Add note</button>
      </form>

      {g.notes?.length > 0 && (
        <div className="panel">
          <div className="eyebrow">Notes</div>
          <ul className="notes">
            {g.notes.map((n) => (
              <li key={n.id}>
                <p>{n.text}</p>
                <div className="row gap8">
                  <span className="muted small">{fmtDate(n.t, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                  <button className="linkBtn push" onClick={() => confirm("Delete this note?") && api.patch(g.id, { deleteNoteId: n.id })}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="panel">
        <div className="eyebrow">Interaction history</div>
        <ol className="history">
          {history.map((a) => (
            <li key={a.id} className={`h-${a.type}`}>
              <span className="hIcon"><Icon name={ACT_ICON[a.type] || "clock"} size={13} /></span>
              <div>
                <p>{a.type === "note" ? <><strong>Note:</strong> {a.text}</> : a.text}</p>
                <span className="muted small">{fmtDate(a.t, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function EpisodeTab({ g, api }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="stack16">
      {!["Accepted", "Recorded"].includes(g.stage) && (
        <p className="alert alertInfo">Episode details are usually added once a guest has accepted. Moving them to <StageBadge stage="Recorded" /> adds them to the archive.</p>
      )}
      <div className="panel">
        <EpisodeForm key={g.id} episode={g.episode} onSave={async (episode) => { await api.patch(g.id, { episode }); setOk(true); setTimeout(() => setOk(false), 1600); }} />
        {ok && <span className="savedFlash">Saved</span>}
      </div>
    </div>
  );
}
