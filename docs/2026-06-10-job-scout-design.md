# Job Scout — AI Job-Search Pipeline (Design)

Date: 2026-06-10
Status: Draft for review
Project location: new private repo at `~/projects/jscout` (NOT part of bunch-platform)

## 1. Goal

A fully automated pipeline that discovers new software-developer job postings
(EU/Germany), AI-scores them against Oleksandr's profile, generates tailored
application material for good matches, and delivers results via Telegram —
running on GitHub Actions for ~$5/month or less.

## 2. Scope decisions (from brainstorming Q&A)

| Dimension | Decision |
|---|---|
| End-to-end scope | Discover → rank → tailor. Applying stays manual. No auto-apply. |
| Sources | API-friendly boards + StepStone/Indeed/Xing via aggregator API (no scraping) + company career-page watchlist. No LinkedIn in v1. |
| Location hard filter | Remote (EU-wide, hireable from Germany) OR remote/hybrid in Germany OR Berlin onsite/hybrid. Everything else dropped before scoring. |
| Role target | Senior Frontend (React/TS), Senior Full-stack (TS/Node), Staff/Lead/Principal, Engineering Manager. |
| Tailoring output | Cover-letter draft + fit summary/talking points per good match. |
| Language | English only. German-only postings are surfaced but flagged, never tailored in German. |
| Delivery | Telegram: daily digest (08:30 Berlin) + intraday alerts every 2h (10:00–19:00 Berlin, weekdays) for very strong matches. |
| Runtime | GitHub Actions cron. No server. |
| Stack | TypeScript (Node 22), OpenAI models — cheap mini-class model for bulk scoring, stronger model for tailoring. Cost-optimized. |

## 3. Architecture

Linear staged pipeline; one scheduled run executes all stages in order.
State lives in the repo (committed JSON), so the repo history is the audit log.

```
fetch → normalize+dedupe → hard filter → score (cheap LLM)
      → tailor (strong LLM) → notify (Telegram) → commit state
```

### Repo layout

```
job-scout/
  src/
    sources/          # one module per source, all return JobPosting[]
      arbeitnow.ts
      adzuna.ts
      hn-whoishiring.ts
      remoteok.ts
      jsearch.ts      # Google-for-Jobs aggregator (StepStone/Indeed/Xing coverage)
      watchlist.ts    # Greenhouse/Lever/Personio public JSON endpoints
    pipeline/
      dedupe.ts       # stable hash + cross-source fuzzy (company+title)
      filter.ts       # location/work-mode + title prefilter rules (pure TS)
      score.ts        # cheap-model structured scoring
      tailor.ts       # strong-model cover letter + fit summary
      notify.ts       # Telegram send (alerts / digest)
      state.ts        # load/save state/jobs.json
    run.ts            # entrypoint: --mode=alerts|digest, --dry-run
  state/jobs.json     # committed state (job hash → record)
  matches/            # generated markdown per good match
  fixtures/           # captured real API responses for tests
  profile.md          # CV + preferences narrative (LLM matching target)
  config.json         # thresholds, location rules, watchlist, source toggles, model ids
  .github/workflows/
    alerts.yml        # cron: 0 8-16/2 * * 1-5 (≈10:00–18:00 Berlin summer)
    digest.yml        # cron: 30 6 * * * (≈08:30 Berlin summer)
```

### Pipeline stages

1. **Fetch** — all sources in parallel; each wrapped in its own try/catch
   (per-source isolation). Common output shape:
   `JobPosting { id, source, url, title, company, location, workMode?, description, postedAt, salary? }`.
2. **Normalize + dedupe** — stable hash from `source:sourceId`, plus a fuzzy
   cross-source key (normalized company + title) so the same job from Adzuna
   and JSearch counts once. Skip anything already in state.
3. **Hard filter** — pure TS, zero LLM cost:
   - Location/work-mode rules per §2.
   - Title prefilter dropping obvious non-software roles.
   - German-language detection → flag (`languageFlag: 'de'`), not drop.
4. **Score** — cheap OpenAI model, one call per job, structured output
   (JSON schema via the OpenAI SDK's zod helper). Returns:
   `{ score: 0-100, stackFit, seniorityFit, locationFit, reasoning (1 line), language }`.
   Profile + scoring rubric form a stable prompt prefix. Per-run cap
   (default 100 jobs) bounds cost against source floods.
5. **Tailor** — for jobs with `score >= digestThreshold` (default 60):
   stronger OpenAI model writes an English cover-letter draft + fit
   summary/talking points → saved to `matches/YYYY-MM-DD-<company>-<role>.md`.
6. **Notify** — Telegram Bot API (bot token + chat id in Actions secrets):
   - `--mode=alerts` (intraday): send jobs with `score >= hotThreshold`
     (default 80) not yet alerted. Message: score, title @ company,
     one-line reasoning, posting URL, link to match file.
   - `--mode=digest` (daily): all new jobs `>= digestThreshold` from the last
     24h, ranked by score, plus a one-line warning for any source that failed
     repeatedly.
7. **Commit state** — the workflow commits `state/jobs.json` + new `matches/*`
   back to the repo. Workflow-level `concurrency` group serializes runs.

### State machine per job

`seen → scored → (hot? alerted) → digested → archived`
Status only advances on success (e.g. a failed Telegram send leaves the job
un-alerted so the next run retries it).

## 4. LLM usage (OpenAI)

- SDK: official `openai` npm package; `OPENAI_API_KEY` in Actions secrets.
- **Scoring model:** cheapest current mini-class model (e.g. gpt-5-mini class);
  exact model id + pricing to be confirmed at implementation time and kept in
  `config.json` so swaps are config-only.
- **Tailoring model:** current mid/strong-tier model — also config-driven.
- Structured outputs (JSON schema / zod helper) for scoring so parsing never
  breaks; plain markdown completion for tailoring.
- Scoring prompt layout: stable system prompt (rubric + profile.md) first,
  per-job posting last — maximizes provider-side prompt caching.

### Cost estimate

| Item | Estimate |
|---|---|
| Scoring (~50 jobs/day worst case) | ~$1–3/month (mini-class pricing) |
| Tailoring (~2–5 matches/day) | ~$1–3/month |
| GitHub Actions | $0 (~400–550 of 2,000 free private-repo minutes) |
| Job-source APIs (Arbeitnow, Adzuna, HN, RemoteOK, JSearch free tiers) | $0 |
| Telegram | $0 |
| **Total** | **~$2–6/month** |

JSearch runs on the daily digest only, to stay inside its free quota.

## 5. Scheduling

GitHub cron is UTC; Berlin offset shifts +1h in winter (accepted drift, noted
in workflow comments). Cron is best-effort — runs may start minutes late.

- `alerts.yml`: `0 8-16/2 * * 1-5` → 10/12/14/16/18h Berlin (summer), Mon–Fri.
- `digest.yml`: `30 6 * * *` → 08:30 Berlin (summer), daily.
- Both call `src/run.ts --mode=...`; both have `workflow_dispatch` for manual runs.

## 6. Error handling

- **Per-source isolation:** one failing source never kills the run; repeated
  failures (3+ consecutive) get a warning line in the next digest.
- **LLM failures:** job stays `seen`, retried next run. SDK retries 429/5xx.
- **Telegram failures:** status doesn't advance; retried next run.
- **Workflow failure:** GitHub's default failure email — no custom alerting.
- **Cost guard:** per-run scoring cap (default 100 jobs).

## 7. Testing

- `vitest` unit tests for every pure stage: per-source normalization, dedupe
  hashing, filter rules, threshold/status-machine logic — against `fixtures/`
  captured from real API responses.
- OpenAI + Telegram clients mocked at module boundary; tests are offline.
- `--dry-run`: full pipeline on fixtures, prints would-be messages, writes
  nothing — runs in CI on PRs and locally.

## 8. Out of scope (v1)

- LinkedIn (no public API; ToS-grey scraping) — revisit only if coverage gaps show up.
- Playwright scrapers for StepStone/Xing — deferred; JSearch covers the bulk.
- Auto-apply — explicitly rejected.
- German-language cover letters.
- Web dashboard / Notion tracker — Telegram + repo markdown files are the UI.

## 9. User-provided inputs (before first run)

1. CV content for `profile.md` (paste or file; converted to a matching narrative).
2. Telegram bot token (via @BotFather) + chat id.
3. API keys: OpenAI, Adzuna (free signup), RapidAPI/JSearch (free tier).
4. A new private GitHub repo with the above as Actions secrets.
