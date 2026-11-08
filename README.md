# Podcast Guest Predictor & Invite Generator

Predicts how likely a LinkedIn professional is to accept an Entri Podcast invitation, then drafts a personalized invite for them, using the Gemini API.

Built by Raghavendra. Current version: **2.2**.

## Versions

- **2.2**: optional cloud database (Supabase / Neon PostgreSQL) via `DATABASE_URL`, migration script, settings stored with the data, storage status in Settings → Data.
- **2.1**: smarter predictions, multiple AI providers, themes.
  - Outcomes tracked separately: Discovered, Shortlisted, Contact later, Contacted, Not responded, Responded, Accepted, Rejected, Recorded.
  - Outcome learning (`lib/learning.js`): each guest's AI score is adjusted (±15 max) using traits of past guests who accepted or rejected (seniority, role, experience, industry, expertise, behavioural signals; company is a minor trait; native language/region never used), with the reasons shown. Relevant / not relevant feedback on guests and AI ideas.
  - AI providers (`lib/ai/`): Gemini, OpenAI, Claude, DeepSeek and any OpenAI-compatible API behind one interface. Keys are AES-256-GCM encrypted in `data/providers.json` (key: `APP_ENCRYPTION_KEY`), never sent to the browser. Priority order, backup models, automatic fallback on rate limits/quota/overload, a stop with a clear message on invalid keys, connection tests, model lists, per-provider usage, limits and alerts.
  - Light / Dark / System theme, saved per browser.
  - Guest photos: paste, drop, upload or a photo link (saved locally so expiring LinkedIn links keep working); Gravatar from email; initials otherwise.
- **2.0**: guest CRM. New premium design (sidebar app, Geist type, iris accent, light and dark).
  - Dashboard: totals, pipeline funnel, conversion rate, company breakdown, follow-ups due, next best guest.
  - Pipeline board: Discovered → Shortlisted → Contacted → Responded → Confirmed → Recorded, with drag and drop.
  - Guest profile: photo, company logo, contact details (from the profile or added by you), notes, interaction history, follow-up reminders and episode details.
  - Guests list: filter by company, location, designation, industry, score and stage; duplicate detection; CSV export that opens in Excel.
  - Companies page, a recorded-episode archive, and Recommendations (next best guest, similar profiles, AI ideas for companies and profile types).
  - API usage moved into Settings.
  - Guests are stored in `data/guests.json`; v1 browser history is imported automatically and duplicates are merged.
- **1.1**: new "Studio" design (ink header, coral accent, Instrument Serif + Plus Jakarta Sans), no Entri brand assets, "Built by Raghav" footer and version label.
- **1.0**: first release with the Entri brand design. Restore it with `git checkout v1.0` (back to the latest with `git checkout main`).

## Tests

```bash
npm test
```

37 automated tests, about one second, no API keys or quota needed:
- `tests/logic.test.mjs`: scoring, stages and funnel, follow-ups, duplicates, CSV, career calculations (order, promotions, moves, overlaps), and outcome learning (similar profiles up, past no's down, no blanket company boost, ±15 cap, language/region never used).
- `tests/ai-fallback.test.mjs`: runs against fake providers in a temporary folder. Rate limit → next provider, invalid key → stop, manual pinning, PDF capability, disabled providers, priority, encrypted keys, per-provider usage and limit alerts.

Run them after any change.

## Cloud storage (use the app from any computer)

By default all data lives in the `data/` folder on this computer. To keep it in a cloud PostgreSQL database instead:

1. Create a free project at https://supabase.com (or https://neon.tech).
2. Copy the connection string. In Supabase: **Connect → Session pooler** (looks like `postgresql://postgres.xxxx:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`).
3. Add it to `.env.local`:
   ```
   DATABASE_URL=postgresql://...
   ```
4. Copy your existing local data into it (safe to run more than once):
   ```bash
   node --env-file=.env.local scripts/migrate-to-db.mjs
   ```
5. Restart the app. **Settings → Data** shows "Cloud database · Connected".

The app creates its tables automatically (`guests`, `app_kv`, `usage_events`, `photos`). Guests, notes, history, photos, AI provider settings, usage and podcast settings are all stored there.

**On a new laptop:** clone/copy the app, run `npm install`, and copy `.env.local` across. It must include the same `DATABASE_URL`, `GEMINI_API_KEY` and **`APP_ENCRYPTION_KEY`** (without it, API keys saved in Settings can't be decrypted). Keep `.env.local` private and out of git.

## Setup

1. Get a Gemini API key at https://aistudio.google.com/apikey
2. Copy `.env.local.example` to `.env.local` and paste your key into `GEMINI_API_KEY`.
3. Install and run:

   ```bash
   npm install
   npm run dev
   ```

4. Open http://localhost:3000

## How to use

- Paste the guest's LinkedIn URL **and** their profile text (open the profile, Cmd+A, copy, paste), or upload the profile PDF (LinkedIn → More → Save to PDF).
- A URL alone also works sometimes: the app then searches the public web for the person, and warns you to double-check the details.
- You get a full message, a LinkedIn connection note (300 characters or fewer) and a WhatsApp version. All three can be edited and copied.
- **Settings** lets you change your name, the podcast details and both templates. Words in `{curly braces}` are filled in from the profile.
- **History** keeps every guest you've drafted for, with a status (Drafted / Sent / Replied / Scheduled / Recorded / Declined). It's stored in this browser only.

To use a different Gemini model, set `GEMINI_MODEL` in `.env.local` (the default is `gemini-3.5-flash`; if it is busy the app falls back to `gemini-3.5-flash-lite`, then `gemini-3.8-flash`. Change the fallbacks with `GEMINI_FALLBACK_MODELS`).

## API usage

Click **API usage** at the top to see how many Gemini requests and tokens you've used today, over the last 7 days, this month and in total, plus a breakdown by model. Enter your daily request limit (from https://aistudio.google.com/rate-limit) to see how many requests you have left today. Gemini's daily limits reset at midnight Pacific time (12:30 PM IST).

Usage is counted by this app and saved in `data/usage.json`. Google doesn't let apps read the remaining quota, so calls made with the same key outside this app aren't included. For Google's official figures, see https://aistudio.google.com/usage.
