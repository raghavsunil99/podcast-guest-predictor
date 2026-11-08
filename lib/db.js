// Storage layer. With DATABASE_URL set (Supabase, Neon or any PostgreSQL), everything is stored
// in the database so it's available from any computer. Without it, the app keeps using the
// JSON files in data/ as before.
import { promises as fs } from "fs";
import path from "path";
import pg from "pg";

const DATA = path.join(process.cwd(), "data");
export const usingDatabase = () => !!process.env.DATABASE_URL;

let pool = null;
let ready = null;

function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    const local = /localhost|127\.0\.0\.1/.test(url);
    pool = new pg.Pool({
      connectionString: url,
      max: 5,
      ssl: local || /sslmode=disable/.test(url) ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

const SCHEMA = `
create table if not exists guests (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists app_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists usage_events (
  id bigserial primary key,
  t timestamptz not null,
  day text not null,
  data jsonb not null
);
create index if not exists usage_events_day on usage_events (day);
create table if not exists photos (
  id text primary key,
  content_type text not null,
  data bytea not null,
  updated_at timestamptz not null default now()
);`;

export async function db() {
  const p = getPool();
  if (!ready) ready = p.query(SCHEMA).catch((e) => { ready = null; throw e; });
  await ready;
  return p;
}

// ---------- Small JSON documents (providers, status, settings, recommendations…) ----------
export async function readDoc(name, fallback) {
  if (usingDatabase()) {
    const { rows } = await (await db()).query("select value from app_kv where key = $1", [name]);
    return rows.length ? rows[0].value : fallback;
  }
  try {
    return JSON.parse(await fs.readFile(path.join(DATA, `${name}.json`), "utf8"));
  } catch {
    return fallback;
  }
}

export async function writeDoc(name, value, { secret = false } = {}) {
  if (usingDatabase()) {
    await (await db()).query(
      "insert into app_kv (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()",
      [name, JSON.stringify(value)]
    );
    return;
  }
  const file = path.join(DATA, `${name}.json`);
  await fs.mkdir(DATA, { recursive: true });
  await fs.writeFile(file + ".tmp", JSON.stringify(value, null, secret ? 2 : 0), secret ? { mode: 0o600 } : undefined);
  await fs.rename(file + ".tmp", file);
}

// ---------- Guests (one row each, so two computers editing different guests don't clash) ----------
export async function readGuests() {
  if (usingDatabase()) {
    const { rows } = await (await db()).query("select data from guests order by (data->>'createdAt') desc nulls last");
    return rows.map((r) => r.data);
  }
  return readDoc("guests", []);
}

// Saves the guests whose content changed (compared with `before`) and deletes removed ones.
export async function writeGuests(list, before = []) {
  if (!usingDatabase()) return writeDoc("guests", list);
  const prev = new Map(before.map((g) => [g.id, JSON.stringify(g)]));
  const client = await (await db()).connect();
  try {
    await client.query("begin");
    for (const g of list) {
      const json = JSON.stringify(g);
      if (prev.get(g.id) === json) continue;
      await client.query(
        "insert into guests (id, data, updated_at) values ($1, $2, now()) on conflict (id) do update set data = excluded.data, updated_at = now()",
        [g.id, json]
      );
    }
    const keep = new Set(list.map((g) => g.id));
    const gone = before.filter((g) => !keep.has(g.id)).map((g) => g.id);
    if (gone.length) await client.query("delete from guests where id = any($1)", [gone]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ---------- Usage log ----------
export async function appendUsage(entry) {
  if (usingDatabase()) {
    await (await db()).query("insert into usage_events (t, day, data) values ($1, $2, $3)", [entry.t, entry.day, JSON.stringify(entry)]);
    return;
  }
  const all = await readDoc("usage", []);
  all.push(entry);
  await writeDoc("usage", all.slice(-20000));
}

export async function readUsage() {
  if (usingDatabase()) {
    const { rows } = await (await db()).query("select data from usage_events order by id desc limit 20000");
    return rows.reverse().map((r) => r.data);
  }
  return readDoc("usage", []);
}

// ---------- Photos ----------
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

export async function putPhoto(id, buf, type) {
  if (usingDatabase()) {
    await (await db()).query(
      "insert into photos (id, content_type, data, updated_at) values ($1, $2, $3, now()) on conflict (id) do update set content_type = excluded.content_type, data = excluded.data, updated_at = now()",
      [id, type, buf]
    );
    return;
  }
  const dir = path.join(DATA, "photos");
  await fs.mkdir(dir, { recursive: true });
  for (const e of Object.values(EXT)) await fs.rm(path.join(dir, `${id}.${e}`), { force: true });
  await fs.writeFile(path.join(dir, `${id}.${EXT[type]}`), buf);
}

export async function getPhoto(id) {
  if (usingDatabase()) {
    const { rows } = await (await db()).query("select content_type, data from photos where id = $1", [id]);
    return rows.length ? { type: rows[0].content_type, body: rows[0].data } : null;
  }
  for (const [type, ext] of Object.entries(EXT)) {
    try {
      return { type, body: await fs.readFile(path.join(DATA, "photos", `${id}.${ext}`)) };
    } catch {}
  }
  return null;
}

export async function removePhoto(id) {
  if (usingDatabase()) {
    await (await db()).query("delete from photos where id = $1", [id]);
    return;
  }
  for (const ext of Object.values(EXT)) await fs.rm(path.join(DATA, "photos", `${id}.${ext}`), { force: true });
}

export const PHOTO_TYPES = EXT;
