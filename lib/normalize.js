// Deterministic clean-up applied to every profile study, whichever AI produced it.
// Smaller/local models sometimes skip rules the prompt asks for; these fix them in code.

const HONORIFIC_BY_LANGUAGE = { Telugu: "garu", Hindi: "ji", Marathi: "ji", Gujarati: "ji", Punjabi: "ji" };

// Well-known institution families, recognised from the name (more reliable than a guess).
const COLLEGE_TYPES = [
  [/\bIIIT\b|Indian Institute of Information Technology|International Institute of Information Technology/i, "IIIT"],
  [/\bIIT\b|Indian Institute of Technology/i, "IIT"],
  [/\bNIT\b|National Institute of Technology/i, "NIT"],
  [/\bIIM\b|Indian Institute of Management/i, "IIM"],
  [/\bBITS\b|Birla Institute of Technology and Science/i, "BITS"],
];

export function collegeType(name, current) {
  for (const [re, type] of COLLEGE_TYPES) if (re.test(name || "")) return type;
  return current === "IIT" || current === "NIT" || current === "IIIT" || current === "IIM" || current === "BITS" ? "Other" : current;
}

// "Software Engineer 2 @ Microsoft" / "Engineer at Acme" → "Software Engineer 2"
export function cleanRole(role, company) {
  let r = String(role || "").trim();
  if (company) {
    const c = company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    r = r.replace(new RegExp(`\\s*(?:@|\\bat\\b|,|\\|)\\s*${c}\\b.*$`, "i"), "");
  }
  return r.replace(/\s*@\s*$/, "").trim() || String(role || "").trim();
}

// Add the honorific after the first name in each message's opening line, if it's missing.
function addHonorific(msg, firstName, honorific) {
  if (!msg || !firstName || !honorific) return msg;
  const fn = firstName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^(\\s*\\S+(?:\\s+\\S+)?\\s+${fn})(?!\\s+(?:garu|ji)\\b)`, "i");
  const firstLine = msg.split("\n")[0];
  if (!new RegExp(`\\b${fn}\\b`, "i").test(firstLine)) return msg;
  return msg.replace(re, `$1 ${honorific}`);
}

/**
 * @param {object} data   generated result (mutated and returned)
 * @param {string} honorificOverride  "auto" | "none" | explicit honorific
 */
export function normalizeResult(data, honorificOverride = "auto") {
  const p = data.profile || {};
  if (p.currentRole) p.currentRole = cleanRole(p.currentRole, p.currentCompany);
  for (const e of p.education || []) e.type = collegeType(e.institution, e.type);

  const bg = data.background || {};
  if (honorificOverride === "auto") {
    const expected = ["High", "Medium"].includes(bg.confidence) ? HONORIFIC_BY_LANGUAGE[bg.nativeLanguage] || "" : "";
    if (expected && !data.honorific) {
      data.honorific = expected;
      data.honorificReason = `${bg.nativeLanguage} speaker (${bg.confidence.toLowerCase()} confidence) → "${expected}"`;
      for (const k of ["fullMessage", "connectionNote", "whatsappMessage", "followUpMessage"]) {
        data[k] = addHonorific(data[k], p.firstName, expected);
      }
    }
  }
  return data;
}
