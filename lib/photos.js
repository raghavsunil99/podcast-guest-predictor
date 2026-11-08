// Guest photos are saved on this computer (data/photos) so they keep working after LinkedIn's
// signed photo links expire. Gravatar is used as a fallback when a guest has an email.
import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";

const DIR = path.join(process.cwd(), "data", "photos");
const TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const MAX = 3 * 1024 * 1024;

async function save(id, buf, type) {
  const ext = TYPES[type];
  if (!ext) throw new Error("Use a JPG, PNG, WebP or GIF image.");
  if (buf.length > MAX) throw new Error("Image is larger than 3 MB.");
  await fs.mkdir(DIR, { recursive: true });
  for (const e of Object.values(TYPES)) await fs.rm(path.join(DIR, `${id}.${e}`), { force: true });
  await fs.writeFile(path.join(DIR, `${id}.${ext}`), buf);
  return `/api/photos/${id}?v=${Date.now().toString(36)}`;
}

// Accepts an https image URL (downloaded now) or a data: URL (from upload/paste).
export async function storePhoto(id, src) {
  const safeId = String(id).replace(/[^a-z0-9]/gi, "");
  if (src.startsWith("data:")) {
    const m = src.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
    if (!m) throw new Error("Unsupported image data.");
    return save(safeId, Buffer.from(m[2], "base64"), m[1].toLowerCase());
  }
  const url = new URL(src);
  if (url.protocol !== "https:") throw new Error("Use an https image link.");
  const r = await fetch(url, { redirect: "follow", headers: { Accept: "image/*" } });
  if (!r.ok) throw new Error(`Couldn't download that image (HTTP ${r.status}). If it's from LinkedIn, the link may have expired — copy it again.`);
  const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/")) throw new Error("That link isn't an image. Right-click the photo and choose “Copy image address”.");
  return save(safeId, Buffer.from(await r.arrayBuffer()), type);
}

export async function readPhoto(id) {
  const safeId = String(id).replace(/[^a-z0-9]/gi, "");
  for (const [type, ext] of Object.entries(TYPES)) {
    try {
      return { body: await fs.readFile(path.join(DIR, `${safeId}.${ext}`)), type };
    } catch {}
  }
  return null;
}

export async function deletePhoto(id) {
  const safeId = String(id).replace(/[^a-z0-9]/gi, "");
  for (const ext of Object.values(TYPES)) await fs.rm(path.join(DIR, `${safeId}.${ext}`), { force: true });
}

// Gravatar: public avatar API keyed by a SHA-256 hash of the email. d=404 → no generic image.
export function gravatarUrl(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return "";
  return `https://gravatar.com/avatar/${crypto.createHash("sha256").update(e).digest("hex")}?s=200&d=404`;
}

export const decorate = (g) => (g ? { ...g, gravatarUrl: gravatarUrl(g.contact?.email) } : g);
