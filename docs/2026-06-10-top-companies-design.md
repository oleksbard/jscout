# Weekly Top-Paying Companies List (Design)

Date: 2026-06-10
Status: Approved (brainstormed with Oleksandr)
Builds on: docs/2026-06-10-job-scout-design.md

## 1. Goals

1. Maintain an automatically refreshed list of the top companies by senior
   software-engineer total compensation that are realistically employable from
   Germany: a German office, or established EU-remote hiring.
2. Refresh the list once a week with no manual work.
3. Feed the list into the existing watchlist monitoring so alerts/digest runs
   pick up new positions at those companies automatically.

## 2. Decisions

| Dimension | Decision |
|---|---|
| Salary-ranking source | LLM web research: one weekly OpenAI call with the `web_search` tool compiles/refreshes the list (levels.fyi, Kununu/Glassdoor reports, news). No scraping, no new API keys. |
| Geographic scope | Germany office **or** EU-remote hiring that covers Germany. Captured per company as `germanyPresence: 'office' \| 'remote-eu'`. |
| List size | `topCompanies.count`, loader default `30`. |
| Research model | `models.research`, loader default `gpt-5` (one call/week — cost negligible). |
| Monitoring integration | Auto-discover each company's ATS board (Greenhouse/Lever/Personio) and merge verified slugs into the watchlist source at fetch time. |
| Output artifact | `state/companies.json`, committed by the workflow like other state. |
| Schedule | New `.github/workflows/companies.yml`: cron `0 5 * * 1` (Mon 07:00 Berlin summer, 06:00 winter — same accepted DST drift as other workflows), plus `workflow_dispatch`. Same `job-scout` concurrency group to avoid state-commit races. |
| Visibility | Weekly Telegram summary: total count, added/dropped vs previous week, companies without discoverable boards. |

## 3. Components

### src/research/top-companies.ts — LLM research

- `researchTopCompanies(client, model, count)` calls the OpenAI Responses API
  with the `web_search` tool and a structured-output schema (zod), asking for
  the top `count` tech employers by senior-SWE total comp in scope.
- Validated entry shape:
  `{ name, reason, estSeniorTotalCompEur, germanyPresence, ats: { vendor: 'greenhouse' | 'lever' | 'personio' | 'other' | 'unknown', slugGuesses: string[] } }`.
- Invalid/empty output → throw; the run fails without touching the artifact.

### src/research/verify-boards.ts — ATS board discovery

- For each company, candidate slugs = LLM `slugGuesses` + derived variants
  (lowercase, spaces/punctuation stripped).
- Probes (cheap public endpoints, via existing `mapWithConcurrency`):
  - greenhouse: `GET https://boards-api.greenhouse.io/v1/boards/{slug}` →
    200 **and** the board `name` matches the company name after normalization
    (lowercase, alphanumerics only, substring either way — guards against
    slug collisions).
  - lever: `GET https://api.lever.co/v0/postings/{slug}?mode=json&limit=1` → 200.
  - personio: `GET https://{slug}.jobs.personio.de/search.json` → 200.
- First verified hit wins; no hit → `board: null`.
- Slug cache: a company already in the previous `companies.json` with a
  verified board keeps it without re-probing.

### state/companies.json — generated artifact

```json
{
  "updatedAt": "2026-06-15T05:04:00.000Z",
  "companies": [
    {
      "name": "Stripe",
      "reason": "…",
      "estSeniorTotalCompEur": 180000,
      "germanyPresence": "remote-eu",
      "board": { "vendor": "greenhouse", "slug": "stripe" }
    }
  ]
}
```

- Companies without a board stay on the list (visible in file + Telegram);
  they are not board-monitored but still surface via the broad Adzuna/JSearch
  searches.

### src/run-companies.ts — entrypoint

- `npm run companies`: load config + previous artifact → research → verify →
  write artifact → Telegram summary.
- `npm run companies:dry-run`: fixture LLM response, no network, no writes
  outside the dry-run path — same pattern as the existing dry-run.

### Watchlist merge (src/sources/*)

- `buildSourceTasks`/`fetchWatchlist` load `state/companies.json`
  (missing file → no generated entries) and merge verified slugs with the
  manual `config.json` watchlist, deduped per vendor. Manual entries are
  never removed by the generator.

### Config additions

- `topCompanies: { count: number }` (default 30).
- `models.research: string` (default `gpt-5`).

## 4. Error handling

- LLM failure / zod-invalid output → previous `companies.json` kept, process
  exits non-zero (red workflow run).
- All board probes fail (network wipe-out) → same: keep old artifact, fail.
  Mirrors the watchlist's existing "only a total wipe-out is a failure" rule.
- Individual probe failure → that company gets `board: null`, run continues.
- A generated slug that later starts 404ing is skipped per-company by the
  existing `fetchWatchlist` error handling.

## 5. Testing

Repo pattern — pure functions unit-tested with vitest + fixtures:

- zod schema accepts fixture LLM output; rejects malformed entries.
- Slug-variant derivation (names with spaces, umlauts, punctuation).
- Greenhouse name-match guard.
- Manual + generated watchlist merge (dedupe, manual preserved,
  missing artifact).
- Week-over-week diff (added/dropped) for the Telegram summary.
- Dry-run exercises the full flow without network.

## 6. Out of scope

- Querying JSearch/Adzuna per company name for companies without boards
  (quota cost; broad searches already cover them). Possible later extension.
- Observed-salary feedback loop (adjusting rankings from posted salaries).
- Supporting additional ATS vendors (Workday, SmartRecruiters, Ashby) —
  add if the no-board count turns out high in practice.
