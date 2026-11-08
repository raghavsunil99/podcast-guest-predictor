"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "@/components/icons";
import Dashboard from "@/components/Dashboard";
import Discover from "@/components/Discover";
import Pipeline from "@/components/Pipeline";
import Guests from "@/components/Guests";
import Companies from "@/components/Companies";
import Recommendations from "@/components/Recommendations";
import Archive from "@/components/Archive";
import Settings from "@/components/Settings";
import GuestDrawer from "@/components/GuestDrawer";
import { ThemeSwitcher, useTheme } from "@/components/ui";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import { followUpsDue } from "@/lib/crm";
import { applyLearning, buildModel } from "@/lib/learning";

const APP_VERSION = "2.2";
const SETTINGS_KEY = "epi.settings.v1";
const HISTORY_KEY = "epi.history.v1";
const MIGRATED_KEY = "epi.migrated.v2";

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", title: "Dashboard", sub: "How your guest outreach is going" },
  { id: "discover", label: "Discover", icon: "discover", title: "Discover guests", sub: "Study a LinkedIn profile, predict a yes, and draft the invite" },
  { id: "pipeline", label: "Pipeline", icon: "pipeline", title: "Pipeline", sub: "Drag guests through Discovered → Shortlisted → Contacted → Responded → Accepted → Recorded" },
  { id: "guests", label: "Guests", icon: "users", title: "Guests", sub: "Every guest you've studied, with filters and export" },
  { id: "companies", label: "Companies", icon: "building", title: "Companies", sub: "Guests discovered, contacted and recorded per company" },
  { id: "recommendations", label: "Recommendations", icon: "compass", title: "Recommendations", sub: "Who to approach next and where to look" },
  { id: "archive", label: "Recorded", icon: "archive", title: "Recorded episodes", sub: "Your archive of recorded conversations" },
];
const SETTINGS_NAV = { id: "settings", label: "Settings", icon: "settings", title: "Settings", sub: "AI providers, usage, podcast details, workflow and appearance" };

function loadLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [view, setView] = useState("dashboard");
  const [viewParams, setViewParams] = useState(null);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [rawGuests, setGuests] = useState([]);
  const [providers, setProviders] = useState([]);
  const [themePref, setThemePref] = useTheme();
  const [settingsTab, setSettingsTab] = useState("providers");
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [usage, setUsage] = useState(null);
  const [toast, setToast] = useState("");
  const [navOpen, setNavOpen] = useState(false);

  const flash = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2600);
  }, []);

  const warned = useMemo(() => new Set(), []);
  const refreshUsage = useCallback(async () => {
    try {
      const r = await fetch("/api/usage", { cache: "no-store" });
      if (!r.ok) return;
      const u = await r.json();
      setUsage(u);
      // Notify once per session when a provider crosses its usage threshold.
      for (const a of u.alerts || []) {
        if (warned.has(a.providerId)) continue;
        warned.add(a.providerId);
        flash(`${a.name} has used ${a.used} of ${a.limit} requests today (${a.pct}%)`);
      }
    } catch {}
  }, [flash, warned]);

  const refreshProviders = useCallback(async () => {
    try {
      const r = await fetch("/api/providers", { cache: "no-store" });
      if (r.ok) setProviders((await r.json()).providers || []);
    } catch {}
  }, []);
  useEffect(() => {
    refreshProviders();
    refreshUsage();
  }, [refreshProviders, refreshUsage]);

  // Outcome learning: every guest's score is the AI profile score adjusted by what happened
  // with similar past guests. Recomputed whenever any guest changes.
  const model = useMemo(() => buildModel(rawGuests), [rawGuests]);
  const guests = useMemo(() => rawGuests.map((g) => applyLearning(g, model)), [rawGuests, model]);

  // Hash routing so the browser back button and refresh keep the current page.
  useEffect(() => {
    const read = () => {
      const h = location.hash.replace("#", "");
      if ([...NAV, SETTINGS_NAV].some((n) => n.id === h)) setView(h);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    // Settings live on the server (database or data/ folder). Older browser-only settings move there once.
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const local = loadLocal(SETTINGS_KEY, null);
        const s = d.settings || local || {};
        setSettings({ ...DEFAULT_SETTINGS, ...s });
        if (!d.settings && local) fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: local }) });
      })
      .catch(() => setSettings({ ...DEFAULT_SETTINGS, ...loadLocal(SETTINGS_KEY, {}) }));
    (async () => {
      try {
        let list = (await (await fetch("/api/guests", { cache: "no-store" })).json()).guests || [];
        // One-time move of v1 browser history into the guest store.
        const legacy = loadLocal(HISTORY_KEY, []);
        if (!loadLocal(MIGRATED_KEY, false) && legacy.length) {
          const r = await fetch("/api/guests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import", entries: legacy }) });
          const out = await r.json();
          if (r.ok) {
            localStorage.setItem(MIGRATED_KEY, "true");
            if (out.added) {
              list = (await (await fetch("/api/guests", { cache: "no-store" })).json()).guests || [];
              flash(`Imported ${out.added} guests from your history`);
            }
          }
        }
        setGuests(list);
        // Older guests saved career history as plain text; convert it to the structured timeline once.
        if (list.some((g) => g.result?.profile && !g.result.profile.experience?.length && !g.careerConvertTried)) {
          fetch("/api/guests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "career" }) })
            .then((r) => r.json())
            .then(async (out) => {
              if (out.updated) {
                setGuests((await (await fetch("/api/guests", { cache: "no-store" })).json()).guests || []);
                flash(`Career history organised for ${out.updated} guest${out.updated > 1 ? "s" : ""}`);
              }
            })
            .catch(() => {});
        }
        // Older guests have no company website (needed for logos); look those up once.
        if (list.some((g) => g.company && !g.enrichTried && (!g.companyDomain || !g.industry))) {
          fetch("/api/guests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "enrich" }) })
            .then((r) => r.json())
            .then(async (out) => {
              if (out.updated) setGuests((await (await fetch("/api/guests", { cache: "no-store" })).json()).guests || []);
            })
            .catch(() => {});
        }
      } finally {
        setLoaded(true);
      }
    })();
  }, [flash]);

  const go = useCallback((id, params = null) => {
    setViewParams(params);
    setView(id);
    setNavOpen(false);
    if (location.hash !== `#${id}`) history.pushState(null, "", `#${id}`);
    window.scrollTo({ top: 0 });
  }, []);

  const api = useMemo(
    () => ({
      go,
      open: (id) => setOpenId(id),
      async save(result, url) {
        const r = await fetch("/api/guests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", result, url }) });
        if (!r.ok) return null;
        const out = await r.json();
        setGuests((list) => [out.guest, ...list.filter((g) => g.id !== out.guest.id)]);
        return out;
      },
      async patch(id, body) {
        const r = await fetch(`/api/guests/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!r.ok) {
          const e = await r.json().catch(() => ({}));
          flash(e.error || "Couldn't save that change. Try again.");
          return null;
        }
        const { guest } = await r.json();
        setGuests((list) => list.map((g) => (g.id === id ? guest : g)));
        if (body.stage) flash(`${guest.name} moved to ${body.stage}`);
        if (body.followedUp) flash(`Follow-up logged for ${guest.name}`);
        return guest;
      },
      async remove(id) {
        const r = await fetch(`/api/guests/${id}`, { method: "DELETE" });
        if (r.ok) setGuests((list) => list.filter((g) => g.id !== id));
      },
    }),
    [go, flash]
  );

  function saveSettings(s) {
    setSettings(s);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
      fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: s }) });
    } catch {}
  }

  const dueCount = useMemo(() => followUpsDue(guests, settings.followUpDays || 5).length, [guests, settings.followUpDays]);
  const recordedCount = guests.filter((g) => g.stage === "Recorded").length;
  const page = [...NAV, SETTINGS_NAV].find((n) => n.id === view) || NAV[0];
  const openGuest = guests.find((g) => g.id === openId);
  const props = { guests, api, settings };

  return (
    <div className="app">
      <aside className={`sidebar${navOpen ? " open" : ""}`}>
        <div className="brandRow">
          <span className="brandMark" aria-hidden><Icon name="archive" size={18} strokeWidth={2} /></span>
          <div className="brandText">
            <strong>Guest Predictor</strong>
            <span>{settings.podcastName}</span>
          </div>
          <button className="iconBtn navToggle" onClick={() => setNavOpen((v) => !v)} aria-label="Menu"><Icon name={navOpen ? "x" : "menu"} /></button>
        </div>

        <button className="btn btnPrimary newBtn" onClick={() => go("discover")}>
          <Icon name="plus" size={16} />Study a profile
        </button>

        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.id} className={`navItem${view === n.id ? " active" : ""}`} onClick={() => go(n.id)} aria-current={view === n.id ? "page" : undefined}>
              <Icon name={n.icon} size={18} />
              <span>{n.label}</span>
              {n.id === "guests" && guests.length > 0 && <span className="navCount">{guests.length}</span>}
              {n.id === "pipeline" && dueCount > 0 && <span className="navCount alert" title={`${dueCount} follow-ups due`}>{dueCount}</span>}
              {n.id === "archive" && recordedCount > 0 && <span className="navCount">{recordedCount}</span>}
            </button>
          ))}
        </nav>

        <div className="sideBottom">
          {usage?.alerts?.length > 0 && (
            <button className="usageAlert" onClick={() => { setSettingsTab("usage"); go("settings"); }}>
              <Icon name="zap" size={14} />
              <span>{usage.alerts.map((a) => `${a.name} ${a.pct}%`).join(" · ")} of daily limit</span>
            </button>
          )}
          <button className={`navItem${view === "settings" ? " active" : ""}`} onClick={() => go("settings")}>
            <Icon name="settings" size={18} />
            <span>Settings</span>
          </button>
          <ThemeSwitcher pref={themePref} onChange={setThemePref} />
          <div className="credit">
            <span>Built by <strong>Raghavendra</strong></span>
            <span className="ver">v{APP_VERSION}</span>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="pageHead">
          <div>
            <h1>{page.title}</h1>
            <p>{page.sub}</p>
          </div>
          {view !== "discover" && view !== "settings" && (
            <button className="btn btnPrimary hideSm" onClick={() => go("discover")}><Icon name="plus" size={16} />Study a profile</button>
          )}
        </header>

        {!loaded ? (
          <div className="loadingPage"><span className="btnSpinner big" aria-hidden /></div>
        ) : (
          <div className="pageBody" key={view}>
            {view === "dashboard" && <Dashboard {...props} />}
            {view === "pipeline" && <Pipeline {...props} />}
            {view === "guests" && <Guests {...props} initialFilter={viewParams} key={JSON.stringify(viewParams)} />}
            {view === "companies" && <Companies {...props} />}
            {view === "recommendations" && <Recommendations {...props} model={model} flash={flash} onUsageChange={refreshUsage} />}
            {view === "archive" && <Archive {...props} />}
            {view === "settings" && (
              <Settings
                settings={settings}
                onSave={saveSettings}
                usage={usage}
                refreshUsage={refreshUsage}
                guests={guests}
                providers={providers}
                refreshProviders={refreshProviders}
                themePref={themePref}
                setThemePref={setThemePref}
                tab={settingsTab}
                setTab={setSettingsTab}
                flash={flash}
              />
            )}
          </div>
        )}
        {/* Kept mounted so a half-filled form or the latest result survive page switches. */}
        <div hidden={view !== "discover"} className="pageBody">
          <Discover
            {...props}
            providers={providers}
            flash={flash}
            onUsageChange={() => { refreshUsage(); refreshProviders(); }}
            openProviders={() => { setSettingsTab("providers"); go("settings"); }}
          />
        </div>
      </main>

      {openGuest && <GuestDrawer key={openGuest.id} guest={openGuest} api={api} settings={settings} onClose={() => setOpenId(null)} />}
      {toast && <div className="toast" role="status"><Icon name="check" size={15} />{toast}</div>}
    </div>
  );
}
