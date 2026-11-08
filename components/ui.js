"use client";

import { useEffect, useId, useRef, useState } from "react";
import Icon from "./icons";
import { STAGE_HINT, TIERS, stageClass, tierOf } from "@/lib/crm";

export const fmt = (n) => (n ?? 0).toLocaleString("en-IN");
export const pct = (x) => `${Math.round((x || 0) * 100)}%`;
export function fmtDate(iso, opts = { day: "numeric", month: "short", year: "numeric" }) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", opts);
}
export function timeAgo(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(iso, { day: "numeric", month: "short" });
}

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// Counts from 0 (or the previous value) up to `target` with an ease-out curve.
export function useCountUp(target, duration = 900) {
  const [v, setV] = useState(reducedMotion() ? target : 0);
  const from = useRef(0);
  useEffect(() => {
    if (typeof target !== "number") return;
    if (reducedMotion()) {
      setV(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      setV(a + (target - a) * e);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return v;
}

// Animated score ring. Colour, gradient and a one-time soft glow follow the tier.
export function ScoreRing({ score, likelihood, size = 132, stroke = 10, label = true, animate = true }) {
  const id = useId().replace(/:/g, "");
  const tier = tierOf({ score, likelihood });
  const value = typeof score === "number" ? score : 0;
  const counted = useCountUp(value);
  const shown = animate ? counted : value;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, shown)) / 100;
  const small = size < 60;
  return (
    <div className={`ring ring-${tier}${small ? " ringSmall" : ""}`} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${value} out of 100, ${TIERS[tier].label}`}>
        <defs>
          <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" className="ringStopA" />
            <stop offset="100%" className="ringStopB" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} className="ringTrack" strokeWidth={stroke} />
        {typeof score === "number" && <circle
          cx={size / 2} cy={size / 2} r={r} className="ringFill" strokeWidth={stroke} stroke={`url(#g${id})`}
          strokeDasharray={`${c * p} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />}
      </svg>
      <div className="ringCenter">
        <span className="ringNum" style={small ? undefined : { fontSize: Math.round(size * 0.25) }}>{typeof score === "number" ? Math.round(shown) : "–"}</span>
        {label && !small && <span className="ringOf">/ 100</span>}
      </div>
    </div>
  );
}

export function TierBadge({ guest, score, likelihood, short = false }) {
  const sc = guest ? guest.score : score;
  if (typeof sc !== "number" && !(guest ? guest.likelihood : likelihood)) {
    return <span className="tier tier-None"><span className="tierDot" aria-hidden />Not scored</span>;
  }
  const tier = tierOf(guest || { score, likelihood });
  return (
    <span className={`tier tier-${tier}`}>
      <span className="tierDot" aria-hidden />
      {short ? TIERS[tier].short : TIERS[tier].label}
    </span>
  );
}

export function StageBadge({ stage }) {
  return (
    <span className={`stage ${stageClass(stage)}`} title={STAGE_HINT[stage]}>
      {stage}
    </span>
  );
}

const AVATAR_HUES = [252, 200, 160, 28, 330, 12];
function hashHue(s) {
  let h = 0;
  for (const ch of String(s || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}
const initials = (name) =>
  String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

// Shows the first photo that loads: saved photo → Gravatar (from email) → initials.
// Never a random or stock picture.
export function Avatar({ name, src, alt, size = 36, ring }) {
  const sources = [src, alt].filter(Boolean);
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [src, alt]);
  const hue = hashHue(name);
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.38) };
  if (idx < sources.length) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={`avatar${ring ? " avatarRing" : ""}`}
        src={sources[idx]}
        alt=""
        style={style}
        onError={() => setIdx((i) => i + 1)}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span className={`avatar avatarInitials${ring ? " avatarRing" : ""}`} style={{ ...style, "--h": hue }} aria-hidden>
      {initials(name)}
    </span>
  );
}

// Light / Dark / System. The choice is stored in this browser and applied before first paint
// by the inline script in app/layout.js.
export const THEME_KEY = "epi.theme";
export function applyTheme(pref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.themePref = pref;
}
export function useTheme() {
  const [pref, setPref] = useState("system");
  useEffect(() => {
    let saved = "system";
    try {
      saved = localStorage.getItem(THEME_KEY) || "system";
    } catch {}
    setPref(saved);
  }, []);
  useEffect(() => {
    applyTheme(pref);
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [pref]);
  const set = (p) => {
    setPref(p);
    try {
      localStorage.setItem(THEME_KEY, p);
    } catch {}
  };
  return [pref, set];
}

export function ThemeSwitcher({ pref, onChange, labels = false }) {
  const opts = [
    { v: "light", icon: "sun", label: "Light" },
    { v: "dark", icon: "moon", label: "Dark" },
    { v: "system", icon: "monitor", label: "System" },
  ];
  return (
    <div className={`themeSwitch${labels ? " withLabels" : ""}`} role="radiogroup" aria-label="Theme">
      {opts.map((o) => (
        <button key={o.v} role="radio" aria-checked={pref === o.v} className={pref === o.v ? "on" : ""} onClick={() => onChange(o.v)} title={`${o.label} theme`}>
          <Icon name={o.icon} size={15} />
          {labels && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

// Company logo from the company's website domain (via /api/logo). Falls back to a monogram
// when there's no domain or no icon is known for it.
export function CompanyLogo({ name, domain, size = 22 }) {
  const [state, setState] = useState("loading");
  useEffect(() => setState("loading"), [domain]);
  const style = { width: size, height: size, fontSize: Math.max(9, size * 0.42) };
  if (!domain || state === "fallback") {
    return (
      <span className="logo logoMono" style={{ ...style, "--h": hashHue(name) }} aria-hidden>
        {String(name || "?").trim().charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="logo"
      style={style}
      alt=""
      src={`/api/logo?domain=${encodeURIComponent(domain)}`}
      onLoad={() => setState("ok")}
      onError={() => setState("fallback")}
    />
  );
}

export function CompanyName({ name, domain, size = 18, className = "" }) {
  if (!name) return null;
  return (
    <span className={`companyName ${className}`}>
      <CompanyLogo name={name} domain={domain} size={size} />
      <span>{name}</span>
    </span>
  );
}

export function Drawer({ onClose, children, wide, label }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <aside className={`drawer${wide ? " drawerWide" : ""}`} role="dialog" aria-label={label} onMouseDown={(e) => e.stopPropagation()}>
        {children}
      </aside>
    </div>
  );
}

export function Empty({ icon = "users", title, children, action }) {
  return (
    <div className="emptyState">
      <span className="emptyIcon"><Icon name={icon} size={22} /></span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count != null && <span className="segCount">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function useCopy() {
  const [copied, setCopied] = useState("");
  async function copy(text, key = "x") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 1500);
      return true;
    } catch {
      return false;
    }
  }
  return [copied, copy];
}

// Remembered per-page layout choice (table / cards / grid / list), kept in this browser.
export function useViewPref(key, fallback) {
  const [v, setV] = useState(fallback);
  useEffect(() => { try { const s = localStorage.getItem(`epi.view.${key}`); if (s) setV(s); } catch {} }, [key]);
  const set = (x) => { setV(x); try { localStorage.setItem(`epi.view.${key}`, x); } catch {} };
  return [v, set];
}

const VIEW_META = { table: ["viewTable", "Table"], cards: ["viewCards", "Cards"], grid: ["viewGrid", "Grid"], list: ["viewList", "List"] };
export function ViewSwitch({ value, onChange, options }) {
  return (
    <div className="segmented viewSwitch" role="tablist" aria-label="Layout">
      {options.map((o) => (
        <button key={o} role="tab" aria-selected={value === o} className={value === o ? "on" : ""} onClick={() => onChange(o)} title={`${VIEW_META[o][1]} view`}>
          <Icon name={VIEW_META[o][0]} size={15} /><span className="vsLabel">{VIEW_META[o][1]}</span>
        </button>
      ))}
    </div>
  );
}
