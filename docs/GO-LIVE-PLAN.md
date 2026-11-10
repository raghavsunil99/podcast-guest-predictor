# Go-live plan (saved, not started)

Goal: run the app online so it works from any device, **free only** (personal, non-commercial project).

Status: **waiting**. Raghavendra will say when to start.

## Free setup chosen

| Part | Service | Plan | Why |
|---|---|---|---|
| Hosting | **Vercel** | Hobby (free) | Built for Next.js; free for personal, non-commercial use; deploys on every `git push` |
| Database + photos | **Supabase** | Free | The app already supports Postgres via `DATABASE_URL`; free plan has 500 MB, plenty for this app |
| AI | Gemini (existing key) | Free tier | Already set up |

Free-plan limits to keep in mind:
- **PDF upload size: max 4.5 MB per PDF** on Vercel. LinkedIn PDFs are usually 1–3 MB.
- **AI requests must finish within Vercel's time limit** (about 5 minutes on Hobby; profile studies take 10–30 s).
- **Supabase pauses a free project after about a week with no use.** Open the app (or the Supabase dashboard) to wake it.
- **Ollama (free local AI) won't work online**, because it runs on the Mac. Online uses Gemini and any other cloud providers.

## Steps

### Part 1: in the code (Claude does this)
1. **Add a password login** so only you can open the app (one password set as `APP_PASSWORD`; signed session cookie; every page and API protected).
2. **Prepare for Vercel:**
   - set `maxDuration` to 300 s
   - show a clear message for PDFs over 4.5 MB
   - add a `/api/health` check
3. **Confirm everything uses the database** when `DATABASE_URL` is set: guests, photos, providers, settings, targets, YouTube stats and keys, company logos.
4. Write `.env.production.example` listing every setting needed.

### Part 2: accounts (you do this; Claude can't create accounts)
5. **Supabase:** sign up at supabase.com → New project (region: Mumbai `ap-south-1`) → set a database password.
   Then go to Project Settings → Database → **Connection string (Session pooler)** and copy it.
6. **Vercel:** sign up at vercel.com with GitHub (Hobby plan) → **Add New Project** → import `raghavsunil99/podcast-guest-predictor`.

### Part 3: connect and move the data (together)
7. In Vercel → Project → Settings → **Environment Variables**, add:
   - `DATABASE_URL`: the Supabase connection string
   - `APP_ENCRYPTION_KEY`: **the same value as in `.env.local`** (otherwise saved AI and YouTube keys can't be read)
   - `GEMINI_API_KEY`: from `.env.local`
   - `APP_PASSWORD`: the login password you choose
   - `YOUTUBE_API_KEY` (optional; it's also stored encrypted in the database)
8. **Copy your data to Supabase** (run once on the Mac):
   - add `DATABASE_URL` to `.env.local`
   - run `node --env-file=.env.local scripts/migrate-to-db.mjs`
   - it copies guests, photos and settings from the `data/` folder
9. **Deploy:** click Deploy in Vercel (later pushes deploy automatically).
10. **Check:** log in at the Vercel link, open Guests, Pipeline and Recorded, study one profile, refresh YouTube stats.

### After going live
- The app's address will be like `podcast-guest-predictor.vercel.app` (a custom domain is optional and free if you own one).
- Keep the local copy as a backup; with `DATABASE_URL` in `.env.local`, the local app and the live app share the same data.
- Never commit `.env.local`; secrets live only in Vercel's settings and on the Mac.
