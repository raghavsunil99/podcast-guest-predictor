// One-time copy of the local data/ folder into the database in DATABASE_URL.
// Run:  node --env-file=.env.local scripts/migrate-to-db.mjs
// Safe to run again: rows are upserted by id/key, and usage events are only copied once.
import { promises as fs } from "fs";
import path from "path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}
const DATA = path.join(process.cwd(), "data");
const local = /localhost|127\.0\.0\.1/.test(url) || /sslmode=disable/.test(url);
const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
const read = async (f, d) => {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA, f), "utf8"));
  } catch {
    return d;
  }
};

await client.connect();
await client.query(`
create table if not exists guests (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists app_kv (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
create table if not exists usage_events (id bigserial primary key, t timestamptz not null, day text not null, data jsonb not null);
create index if not exists usage_events_day on usage_events (day);
create table if not exists photos (id text primary key, content_type text not null, data bytea not null, updated_at timestamptz not null default now());`);

const guests = await read("guests.json", []);
for (const g of guests) {
  await client.query("insert into guests (id, data) values ($1, $2) on conflict (id) do update set data = excluded.data, updated_at = now()", [g.id, JSON.stringify(g)]);
}
console.log(`guests: ${guests.length}`);

for (const key of ["providers", "provider-status", "recommendations", "recommendation-feedback", "settings"]) {
  const v = await read(`${key}.json`, null);
  if (v == null) continue;
  await client.query("insert into app_kv (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()", [key, JSON.stringify(v)]);
  console.log(`${key}: copied`);
}

const { rows } = await client.query("select count(*)::int n from usage_events");
if (rows[0].n === 0) {
  const usage = await read("usage.json", []);
  for (const e of usage) await client.query("insert into usage_events (t, day, data) values ($1, $2, $3)", [e.t, e.day, JSON.stringify(e)]);
  console.log(`usage events: ${usage.length}`);
} else console.log("usage events: already present, skipped");

const TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
let photos = 0;
for (const f of await fs.readdir(path.join(DATA, "photos")).catch(() => [])) {
  const [id, ext] = f.split(".");
  if (!TYPES[ext]) continue;
  await client.query("insert into photos (id, content_type, data) values ($1, $2, $3) on conflict (id) do update set content_type = excluded.content_type, data = excluded.data", [id, TYPES[ext], await fs.readFile(path.join(DATA, "photos", f))]);
  photos++;
}
console.log(`photos: ${photos}`);
await client.end();
console.log("Done. Restart the app; it now reads and writes the database.");
