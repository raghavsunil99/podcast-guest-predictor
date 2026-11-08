# Podcast Guest Predictor & Invite Generator

Predicts how likely a LinkedIn professional is to accept an Entri Podcast invitation, then drafts a personalized invite for them, using the Gemini API.

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
