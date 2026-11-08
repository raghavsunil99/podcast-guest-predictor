// Guest CRM storage: data/guests.json on this computer. Writes are serialized so parallel
// requests can't overwrite each other.
import { promises as fs } from "fs";
import path from "path";
import {
  activity, applyStage, companyKey, guestFromResult, LEGACY_STATUS, migrateStages, newId, normDomain, normLinkedIn, normName,
} from "./crm";

const FILE = path.join(process.cwd(), "data", "guests.json");
let queue = Promise.resolve();

async function readAll() {
  try {
    // v2.0 used Confirmed/Declined; v2.1 tracks Accepted/Rejected (plus Contact later, Not responded).
    return JSON.parse(await fs.readFile(FILE, "utf8")).map(migrateStages);
  } catch {
    return [];
  }
}
async function writeAll(list) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = FILE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(list));
  await fs.rename(tmp, FILE);
}
// Run fn(list) exclusively; if it returns { list }, save it.
function withGuests(fn) {
  const run = queue.then(async () => {
    const list = await readAll();
    const out = await fn(list);
    if (out?.save) await writeAll(list);
    return out?.value;
  });
  queue = run.catch(() => {});
  return run;
}

export const listGuests = () => withGuests((list) => ({ value: list }));

function findMatch(list, f) {
  const li = normLinkedIn(f.linkedinUrl);
  if (li) {
    const byUrl = list.find((g) => normLinkedIn(g.linkedinUrl) === li);
    if (byUrl) return byUrl;
  }
  const n = normName(f.name);
  if (!n || n === "unknown") return null;
  const ck = companyKey(f);
  return list.find((g) => normName(g.name) === n && (!ck || !companyKey(g) || companyKey(g) === ck)) || null;
}

function mergeInto(g, f, now) {
  const contact = { ...(g.contact || {}) };
  const contactSource = { ...(g.contactSource || {}) };
  for (const k of ["email", "phone", "website"]) {
    if (!contact[k] && f.contact[k]) {
      contact[k] = f.contact[k];
      contactSource[k] = "profile";
    }
  }
  Object.assign(g, {
    ...f,
    contact,
    contactSource,
    photoUrl: g.photoUrl || f.photoUrl,
    linkedinUrl: g.linkedinUrl || f.linkedinUrl,
    companyDomain: g.companyDomainEdited ? g.companyDomain : f.companyDomain || g.companyDomain,
    updatedAt: now,
  });
}

function newGuest(f, now, stage = "Discovered") {
  const contactSource = {};
  for (const k of ["email", "phone", "website"]) if (f.contact[k]) contactSource[k] = "profile";
  let g = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    ...f,
    contactSource,
    stage: "Discovered",
    milestones: { Discovered: now },
    notes: [],
    episode: {},
    activity: [activity("created", `Discovered${typeof f.score === "number" ? ` · prediction ${f.score}/100` : ""}`, now)],
  };
  if (stage !== "Discovered") g = applyStage(g, stage, now);
  return g;
}

// Save a fresh generation. Returns { guest, duplicate } — duplicate=true when the guest
// already existed (same LinkedIn URL, or same name at the same company) and was updated instead.
export function upsertFromResult(result, url) {
  return withGuests((list) => {
    const now = new Date().toISOString();
    const f = guestFromResult(result, { url });
    const existing = findMatch(list, f);
    if (existing) {
      mergeInto(existing, f, now);
      existing.activity = [activity("regenerated", "Profile studied again · prediction and invite refreshed", now), ...(existing.activity || [])];
      return { save: true, value: { guest: existing, duplicate: true } };
    }
    const g = newGuest(f, now);
    list.unshift(g);
    return { save: true, value: { guest: g, duplicate: false } };
  });
}

// One-time import of v1 browser history entries.
export function importLegacy(entries) {
  return withGuests((list) => {
    let added = 0;
    for (const e of [...entries].reverse()) {
      if (!e?.result) continue;
      const f = guestFromResult(e.result, { url: e.url });
      if (findMatch(list, f)) continue;
      const t = e.date || new Date().toISOString();
      const g = newGuest(f, t, LEGACY_STATUS[e.status] || "Discovered");
      list.unshift(g);
      added++;
    }
    return { save: added > 0, value: { added } };
  });
}

const EDITABLE = ["name", "role", "company", "industry", "domain", "city", "photoUrl", "linkedinUrl", "nextFollowUpAt", "result", "recFeedback"];

export function updateGuest(id, body) {
  return withGuests((list) => {
    const i = list.findIndex((g) => g.id === id);
    if (i < 0) return { value: null };
    let g = list[i];
    const now = new Date().toISOString();
    if (body.stage) g = applyStage(g, body.stage, now);
    const acts = [];
    if (body.patch) {
      for (const k of EDITABLE) if (k in body.patch) g[k] = body.patch[k];
      if ("companyDomain" in body.patch) {
        g.companyDomain = normDomain(body.patch.companyDomain);
        g.companyDomainEdited = true;
      }
      if ("photoUrl" in body.patch) acts.push(body.patch.photoUrl ? "Profile photo updated" : "Profile photo removed");
      if ("recFeedback" in body.patch) acts.push(body.patch.recFeedback ? `Recommendation marked ${body.patch.recFeedback === "relevant" ? "relevant" : "not relevant"}` : "Recommendation feedback cleared");
      if ("nextFollowUpAt" in body.patch) acts.push(body.patch.nextFollowUpAt ? `Reminder set for ${body.patch.nextFollowUpAt}` : "Reminder cleared");
    }
    if (body.episode) {
      g.episode = { ...(g.episode || {}), ...body.episode };
      acts.push("Episode details updated");
    }
    if (body.contact) {
      const contact = { ...(g.contact || {}) };
      const src = { ...(g.contactSource || {}) };
      const changed = [];
      for (const k of ["email", "phone", "website"]) {
        if (!(k in body.contact)) continue;
        const v = String(body.contact[k] || "").trim();
        if (v === (contact[k] || "")) continue;
        contact[k] = v;
        if (v) src[k] = "manual";
        else delete src[k];
        changed.push(k);
      }
      g.contact = contact;
      g.contactSource = src;
      if (changed.length) acts.push(`Contact details updated (${changed.join(", ")})`);
    }
    if (body.followedUp) {
      g.lastFollowUpAt = now;
      g.followUpCount = (g.followUpCount || 0) + 1;
      if (g.nextFollowUpAt && new Date(g.nextFollowUpAt) <= new Date()) g.nextFollowUpAt = "";
      acts.push(`Follow-up #${g.followUpCount} sent`);
    }
    if (body.logMessage) acts.push(String(body.logMessage).slice(0, 200));
    if (body.note) {
      const text = String(body.note).trim().slice(0, 4000);
      if (text) {
        g.notes = [{ id: newId(), t: now, text }, ...(g.notes || [])];
        g.activity = [activity("note", text, now), ...(g.activity || [])];
      }
    }
    if (body.deleteNoteId) g.notes = (g.notes || []).filter((n) => n.id !== body.deleteNoteId);
    for (const a of acts) g.activity = [activity("update", a, now), ...(g.activity || [])];
    g.updatedAt = now;
    list[i] = g;
    return { save: true, value: g };
  });
}

export function deleteGuest(id) {
  return withGuests((list) => {
    const i = list.findIndex((g) => g.id === id);
    if (i < 0) return { value: false };
    list.splice(i, 1);
    return { save: true, value: true };
  });
}

// Fill companyDomain / industry for guests saved before those fields existed.
// lookup(companies: string[]) → [{ company, domain, industry }]
export async function enrichCompanies(lookup) {
  const list = await listGuests();
  const need = [...new Set(list.filter((g) => g.company && !g.enrichTried && (!g.companyDomain || !g.industry)).map((g) => g.company))];
  if (!need.length) return { updated: 0 };
  const found = await lookup(need);
  const by = new Map(found.map((f) => [String(f.company).toLowerCase(), f]));
  return withGuests((all) => {
    let updated = 0;
    for (const g of all) {
      if (!g.company || g.enrichTried || (g.companyDomain && g.industry)) continue;
      const f = by.get(g.company.toLowerCase());
      g.enrichTried = true;
      if (!f) continue;
      if (!g.companyDomain && f.domain) g.companyDomain = normDomain(f.domain);
      if (!g.industry && f.industry) g.industry = f.industry;
      updated++;
    }
    return { save: true, value: { updated } };
  });
}
