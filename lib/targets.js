// Target companies: AI-suggested companies to find podcast guests at, plus the ones you pin
// and track (Target → Searching → Found guests → Recorded). Counts come from your guest list.
import { companyKey, reached } from "./crm.js";

export const TARGET_STATUSES = ["Target", "Searching", "Found guests", "Recorded"];
export const CATEGORIES = ["Big Tech", "Product unicorn", "Fast-growing startup", "Service→Product switchers", "Global capability centre", "Fintech", "Other"];
export const SIZES = ["Startup (<200)", "Mid-size (200–2,000)", "Large (2,000+)"];

export const targetKey = (name, domain) => companyKey({ company: name, companyDomain: domain });

export const fitLabel = (n) => (n >= 80 ? "Best fit" : n >= 65 ? "Good fit" : "Worth a try");

// How many of your guests work (or worked) at a company.
export function progressFor(key, guests) {
  const now = guests.filter((g) => companyKey(g) === key);
  const former = guests.filter((g) => !now.includes(g) && (g.pastCompanies || []).some((pc) => companyKey({ company: pc }) === key));
  return {
    found: now.length,
    contacted: now.filter((g) => reached(g, "Contacted")).length,
    recorded: now.filter((g) => reached(g, "Recorded")).length,
    former: former.length,
  };
}

// Status moves forward on its own when guests appear; it never moves backward by itself.
export function trackTargets(pinned, guests) {
  return pinned.map((t) => {
    const p = progressFor(t.key, guests);
    const auto = p.recorded ? "Recorded" : p.found ? "Found guests" : null;
    const status = auto && TARGET_STATUSES.indexOf(auto) > TARGET_STATUSES.indexOf(t.status) ? auto : t.status;
    return { ...t, status, progress: p };
  });
}

// Drop suggestions for companies you already have guests from or have pinned, and clean values.
export function cleanSuggestions(items, guests, pinned = []) {
  const explored = new Set(guests.map((g) => companyKey(g)).filter(Boolean));
  const pinnedKeys = new Set(pinned.map((t) => t.key));
  const seen = new Set();
  return (items || [])
    .map((c) => ({
      ...c,
      key: targetKey(c.name, c.domain),
      fitScore: Math.max(0, Math.min(100, Math.round(Number(c.fitScore) || 0))),
      category: CATEGORIES.includes(c.category) ? c.category : "Other",
      domain: String(c.domain || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""),
    }))
    .filter((c) => c.key && !explored.has(c.key) && !pinnedKeys.has(c.key) && !seen.has(c.key) && seen.add(c.key))
    .sort((a, b) => b.fitScore - a.fitScore);
}
