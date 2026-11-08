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
