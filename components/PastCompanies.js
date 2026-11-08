"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { CompanyLogo } from "./ui";
import { companyKey, previousCompanies } from "@/lib/crm";

const DomainsCtx = createContext({});

// Loads known company websites once, then fills in any previous employers that are missing
// (one small AI request, only when new companies appear).
export function DomainsProvider({ guests, children }) {
  const [domains, setDomains] = useState({});
  const sig = guests.map((g) => (g.pastCompanies || []).join("|")).join(";");
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const r = await fetch("/api/company-domains", { cache: "no-store" });
        const d = await r.json();
        if (off) return;
        setDomains(d.domains || {});
        const needs = guests.some((g) => previousCompanies(g, 6).some((n) => !((companyKey({ company: n })) in (d.domains || {}))));
        if (needs) {
          const r2 = await fetch("/api/company-domains", { method: "POST" });
          const d2 = await r2.json();
          if (!off && d2.domains) setDomains(d2.domains);
        }
      } catch {}
    })();
    return () => { off = true; };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return <DomainsCtx.Provider value={domains}>{children}</DomainsCtx.Provider>;
}

export const useDomainFor = () => {
  const map = useContext(DomainsCtx);
  return (name) => map[companyKey({ company: name })] || "";
};

// "Previously: [G] Google · [M] MIT Media Lab"
// variant "row" shows logos with names; "logos" shows only logos (name on hover).
export default function PastCompanies({ g, max = 3, variant = "row", label = "Previously", size = 16 }) {
  const domainFor = useDomainFor();
  const list = previousCompanies(g, max + 5);
  if (!list.length) return null;
  const shown = list.slice(0, max);
  const more = list.length - shown.length;
  const title = `Previously at ${list.join(", ")}`;
  if (variant === "logos") {
    return (
      <span className="pastLogos" title={title} aria-label={title}>
        <span className="pastLbl">ex</span>
        {shown.map((n) => <CompanyLogo key={n} name={n} domain={domainFor(n)} size={size} />)}
        {more > 0 && <span className="pastMore">+{more}</span>}
      </span>
    );
  }
  return (
    <span className="pastRow" title={title}>
      <span className="pastLbl">{label}</span>
      {shown.map((n) => (
        <span key={n} className="pastItem"><CompanyLogo name={n} domain={domainFor(n)} size={size} /><span className="ellipsis">{n}</span></span>
      ))}
      {more > 0 && <span className="pastMore">+{more}</span>}
    </span>
  );
}
