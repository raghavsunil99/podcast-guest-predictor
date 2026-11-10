// Native language: the list you can pick from, applying your correction to a study (greeting,
// honorific, messages), and learning from corrections so the next similar surname gets it right.
// Plain module: used by the browser (editing) and the server (new studies).

export const LANGUAGES = {
  Telugu: { region: "Andhra Pradesh / Telangana", greeting: "Namaskaram", honorific: "garu" },
  Tamil: { region: "Tamil Nadu", greeting: "Vanakkam", honorific: "" },
  Kannada: { region: "Karnataka", greeting: "Namaskara", honorific: "" },
  Malayalam: { region: "Kerala", greeting: "Namaskaram", honorific: "" },
  Hindi: { region: "North India", greeting: "Namaste", honorific: "ji" },
  Marathi: { region: "Maharashtra", greeting: "Namaskar", honorific: "ji" },
  Gujarati: { region: "Gujarat", greeting: "Kem cho", honorific: "ji" },
  Bengali: { region: "West Bengal", greeting: "Nomoshkar", honorific: "" },
  Punjabi: { region: "Punjab", greeting: "Sat Sri Akal", honorific: "ji" },
  Odia: { region: "Odisha", greeting: "Namaskar", honorific: "" },
  Urdu: { region: "", greeting: "Assalamu Alaikum", honorific: "" },
  Konkani: { region: "Goa / coastal Karnataka", greeting: "Dev borem korum", honorific: "" },
  Tulu: { region: "Coastal Karnataka", greeting: "Namaskara", honorific: "" },
  Assamese: { region: "Assam", greeting: "Nomoskar", honorific: "" },
};
export const LANGUAGE_NAMES = Object.keys(LANGUAGES);
const KNOWN_HONORIFICS = ["garu", "ji"];

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Swap the honorific after the first name in each message's greeting ("Ravi garu" → "Ravi ji" / "Ravi").
export function swapHonorific(msg, firstName, from, to) {
  if (!msg || !firstName) return msg;
  const fn = esc(firstName);
  const re = new RegExp(`^([^\\n]*?\\b${fn})(\\s+(?:${KNOWN_HONORIFICS.map(esc).join("|")})\\b)?`, "i");
  return msg.replace(re, (_m, name) => (to ? `${name} ${to}` : name));
}

/** Apply a language you picked (or typed) to a study result. Returns a new result.
 *  language "" means "not sure": the guess is cleared and messages use the first name only. */
export function applyLanguage(result, language, { custom } = {}) {
  const r = structuredClone(result || {});
  const bg = r.background || {};
  const prev = bg.nativeLanguage;
  const info = LANGUAGES[language] || {};
  const first = r.profile?.firstName || "";
  const oldHon = r.honorific || "";
  // Keep an honorific you set by hand (e.g. "Sir") unless it was one we add automatically.
  const auto = !oldHon || KNOWN_HONORIFICS.includes(oldHon);
  const newHon = auto ? (language ? info.honorific ?? "" : "") : oldHon;
  r.background = {
    ...bg,
    nativeLanguage: language || "Unknown",
    nativeRegion: language ? info.region || bg.nativeRegion || "" : "",
    nativeGreeting: language ? info.greeting || bg.nativeGreeting || "" : "",
    confidence: language ? "Confirmed" : "Low",
    corrected: !!language && language !== prev,
    confirmed: !!language,
    aiGuess: bg.aiGuess ?? prev ?? "",
    custom: !!custom,
  };
  if (newHon !== oldHon) {
    r.honorific = newHon;
    r.honorificReason = language ? `You set the language to ${language}` : "Language not sure, so first name only";
    for (const k of ["fullMessage", "connectionNote", "whatsappMessage", "followUpMessage"]) r[k] = swapHonorific(r[k], first, oldHon, newHon);
  }
  return r;
}

// Surname: the last real word of the name ("K V Sandeep" → "sandeep", "Ravi Teja Kondapalli" → "kondapalli").
export function surnameOf(name) {
  const words = String(name || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  return words.length >= 2 ? words[words.length - 1] : "";
}

/** What your confirmed and corrected guests teach: surname → language. */
export function learnLanguageHints(guests) {
  const map = new Map();
  for (const g of guests) {
    const bg = g.result?.background;
    if (!bg?.confirmed || !bg.nativeLanguage || bg.nativeLanguage === "Unknown") continue;
    const s = surnameOf(g.name);
    if (!s) continue;
    const e = map.get(s) || { surname: s, votes: {}, examples: [] };
    e.votes[bg.nativeLanguage] = (e.votes[bg.nativeLanguage] || 0) + (bg.corrected ? 2 : 1);
    e.examples.push({ name: g.name, language: bg.nativeLanguage, corrected: !!bg.corrected, aiGuess: bg.aiGuess || "" });
    map.set(s, e);
  }
  for (const e of map.values()) e.language = Object.entries(e.votes).sort((a, b) => b[1] - a[1])[0][0];
  return map;
}

/** Use your past corrections on a new study: if this surname was corrected before and the AI
 *  guessed differently (and wasn't highly confident), go with what you taught it. */
export function applyLanguageHints(result, hints) {
  const name = result?.profile?.fullName || "";
  const h = hints.get(surnameOf(name));
  const bg = result?.background || {};
  if (!h) return { result, used: null };
  if (bg.nativeLanguage === h.language) {
    bg.signals = [...(bg.signals || []), `Matches what you confirmed for ${h.examples[0].name}`];
    return { result, used: null };
  }
  if (bg.confidence === "High") {
    result.warnings = [...(result.warnings || []), `You set ${h.examples[0].name} (same surname) to ${h.language}, but the AI is confident this is ${bg.nativeLanguage}. Check the language before sending.`];
    return { result, used: null };
  }
  const aiGuess = bg.nativeLanguage;
  const out = applyLanguage(result, h.language);
  out.background.confirmed = false; // learned, not confirmed by you for this guest
  out.background.corrected = false;
  out.background.confidence = "Medium";
  out.background.learned = true;
  out.background.aiGuess = aiGuess;
  out.background.signals = [`Learned from your correction: ${h.examples.map((x) => x.name).slice(0, 2).join(", ")} → ${h.language} (same surname)`, ...(bg.signals || [])];
  return { result: out, used: h };
}

/** A few past corrections to show the AI, so it reasons like you. */
export function hintsForPrompt(hints, limit = 12) {
  const rows = [...hints.values()].filter((h) => h.examples.some((x) => x.corrected)).slice(0, limit);
  if (!rows.length) return "";
  return `The host corrected these language guesses before; follow the same reasoning for similar names:\n${rows
    .map((h) => { const x = h.examples.find((e) => e.corrected); return `- ${x.name}: ${x.aiGuess ? `not ${x.aiGuess}, ` : ""}${h.language}`; })
    .join("\n")}`;
}
