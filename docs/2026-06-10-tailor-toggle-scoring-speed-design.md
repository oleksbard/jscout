# Tailoring Toggle + Scoring Concurrency + Run Logging (Design)

Date: 2026-06-10
Status: Approved (brainstormed with Oleksandr)
Builds on: docs/2026-06-10-job-scout-design.md

## 1. Goals

1. Tailoring (strong-model cover letters) becomes configurable and ships
   disabled — Oleksandr does not want application material for every match.
2. The digest run took 11m34s for 51 scored jobs because scoring is one
   sequential OpenAI call per job. Score with bounded concurrency instead
   (~9 min → ~2 min; same cost, same results).
3. The run was silent for ~10 minutes between the filter log and the first
   tailored file. Add per-job progress and stage-timing logs.

## 2. Decisions

| Dimension | Decision |
|---|---|
| Tailor config | `tailor: boolean`. Loader default `true` (mirrors original design); shipped `config.json` sets `false`. |
| Concurrency config | `scoringConcurrency: number`. Loader default `5`; shipped `config.json` sets `5`. |
| Concurrency impl | Hand-rolled `mapWithConcurrency` in `src/util.ts` (worker pool over shared index — safe on the single-threaded event loop). No new dependency. |
| Tailoring when disabled | Whole tailor stage skipped (no mkdir, no LLM calls, no matchFile). One log line: `tailoring disabled (config.tailor=false)`. Alert/digest formatters already render the match-file line conditionally — no changes. |
| Re-enabling | Flip `"tailor": true` — the existing no-matchFile guard back-fills still-relevant jobs. |

## 3. Orchestrator changes (src/run.ts)

- Build one combined scoring work list: records added from fresh postings
  (addJob, synchronous, capped by budget) plus retry candidates within the
  remaining budget — budget semantics unchanged. Then run `scoreJob` over the
  list with `mapWithConcurrency(records, config.scoringConcurrency, ...)`.
  Per-record try/catch stays inside the worker fn (status only advances on
  success — unchanged).
- Logs:
  - `scoring N jobs (concurrency K)...`
  - per job: `scored <done>/<total>: <score>/100 — <title> @ <company> (<seconds>s)`
    (failures: `scoring failed for <id>, will retry next run: <error>`)
  - `scoring done in <s>s (<ok> ok, <failed> failed)`
  - per tailored job: existing `tailored: <file>` gains `(<seconds>s)`
  - `sending N alerts...` / digest equivalent
  - final `done in <s>s` (total elapsed)

## 4. Testing

- `mapWithConcurrency`: preserves result order; never exceeds the limit
  (tracked via in-flight counter); works when limit > item count.
- Config: `tailor` defaults `true`, `scoringConcurrency` defaults `5`,
  explicit values kept.
- run.ts verified via dry-run (now shows progress lines and, with shipped
  config, no tailored lines).

## 5. Out of scope

- Lower reasoning effort on scoring calls (offered, not chosen).
- Concurrency for tailoring (2–5 calls/day, not worth it).
- Any change to thresholds, selection, or notify formatting.
