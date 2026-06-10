# job-scout

Personal AI job-search pipeline: discovers software jobs (EU/Germany), scores them
against `profile.pdf` with a cheap OpenAI model, writes tailored application material
with a stronger model, and sends Telegram alerts + a daily digest.
Runs on GitHub Actions cron. Design doc lives in `docs/`.

## Setup

1. Export your CV as `profile.pdf` at the repo root (a text-based export from
   Word/Google Docs/LaTeX — not a scan; the pipeline fails fast if the PDF has
   no text layer). Commit it: GitHub Actions reads it from the repo.
2. Create a Telegram bot via @BotFather; get your chat id by messaging the bot
   and calling `https://api.telegram.org/bot<TOKEN>/getUpdates`.
3. Get API keys: OpenAI, Adzuna (free at developer.adzuna.com),
   RapidAPI JSearch (free tier).
4. Add repo Actions secrets: `OPENAI_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`,
   `RAPIDAPI_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
5. Check the model ids in `config.json` against current OpenAI pricing —
   cheap model for scoring, stronger one for tailoring.
6. Add companies you care about to `config.json` → `watchlist`
   (greenhouse/lever/personio board slugs).

## Commands

- `npm test` / `npm run typecheck`
- `npm run dry-run` — full pipeline on fixtures, no network/LLM/Telegram
- `npm run alerts` / `npm run digest` — real runs (need env vars locally)

## Tuning (config.json)

- `tailor` — `false` here by default: no cover-letter generation. Set `true`
  to generate tailored material for every new match ≥ the digest threshold
  (back-fills jobs that are still relevant on the next run).
- `scoringConcurrency` — parallel scoring calls (default 5). Raise for speed,
  lower if you hit OpenAI rate limits.
- `maxJobsScoredPerRun` — cost cap per run (default 100).
- `minSalaryEur` — drop jobs whose stated salary range tops out below this
  (default 0 = off; set to 100000 here). Unstated salaries pass; the scorer
  judges salaries mentioned only in the posting text.

## Schedules (UTC cron; Berlin drifts 1h across DST)

- alerts: every 2h, 10:00–18:00 Berlin, Mon–Fri — hot matches (score ≥ 80)
- digest: 08:30 Berlin daily — all new matches ≥ 60, ranked
