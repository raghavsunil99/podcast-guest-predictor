// Plain text from a PDF, for AI providers that can't read PDF files (local models, DeepSeek…).
import { extractText, getDocumentProxy } from "unpdf";

const MAX_CHARS = 30000;

// Sidebar sections of a browser-saved LinkedIn page that are about OTHER people: cut from here on.
const SIDEBAR = ["More profiles for you", "People also viewed", "People you may know", "Explore Premium profiles", "Explore Premium", "You might like", "Pages for you"];

export function trimLinkedInText(text) {
  const cut = Math.min(...SIDEBAR.map((h) => text.indexOf(h)).filter((i) => i > 500));
  return Number.isFinite(cut) ? text.slice(0, cut).trim() : text;
}

export async function pdfToText(buf) {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    const clean = String(text || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return trimLinkedInText(clean).slice(0, MAX_CHARS);
  } catch {
    return ""; // scanned/image-only PDFs have no text layer
  }
}

// The profile's own LinkedIn address, if the text shows one (browser-printed pages have it in the
// page header/footer; LinkedIn's "Save to PDF" lists it under Contact). Ignores links to other people
// only by taking the most frequent one.
export function findLinkedInUrl(text) {
  const hits = String(text || "").match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]+/gi) || [];
  if (!hits.length) return "";
  const counts = {};
  for (const h of hits) { const slug = h.replace(/^.*\/in\//i, "").toLowerCase(); counts[slug] = (counts[slug] || 0) + 1; }
  const slug = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  return `https://www.linkedin.com/in/${slug}`;
}
