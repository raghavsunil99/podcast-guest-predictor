// AES-256-GCM encryption for provider API keys stored on disk. The master key comes from
// APP_ENCRYPTION_KEY in .env.local; if that's missing, one is generated once into
// data/.master.key (owner read/write only). Keys are never sent to the browser.
import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";

const KEY_FILE = path.join(path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.DATA_DIR || "data"), ".master.key");
let cached = null;

async function masterKey() {
  if (cached) return cached;
  const env = process.env.APP_ENCRYPTION_KEY;
  if (env) {
    const k = Buffer.from(env, "base64");
    if (k.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
    return (cached = k);
  }
  try {
    cached = Buffer.from((await fs.readFile(KEY_FILE, "utf8")).trim(), "base64");
  } catch {
    cached = crypto.randomBytes(32);
    await fs.mkdir(path.dirname(KEY_FILE), { recursive: true });
    await fs.writeFile(KEY_FILE, cached.toString("base64"), { mode: 0o600 });
  }
  return cached;
}

export async function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", await masterKey(), iv);
  const enc = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export async function decrypt(blob) {
  const [v, iv, tag, data] = String(blob || "").split(":");
  if (v !== "v1") throw new Error("Unknown key format");
  const d = crypto.createDecipheriv("aes-256-gcm", await masterKey(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

export const keyHint = (k) => (k && k.length > 8 ? `…${k.slice(-4)}` : "set");
