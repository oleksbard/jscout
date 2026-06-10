# Tailoring Toggle + Scoring Concurrency + Run Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tailoring configurable (shipped off), score jobs with bounded concurrency (~9 min → ~2 min per digest), and add per-job progress + stage-timing logs.

**Architecture:** Two new config fields (`tailor`, `scoringConcurrency`); a hand-rolled `mapWithConcurrency` worker-pool helper in `src/util.ts`; `src/run.ts` builds one combined scoring work list (fresh + retries, budget semantics unchanged) and runs it through the pool with per-job logging; the tailor stage is gated on `config.tailor`.

**Tech Stack:** Existing toolchain only — no new dependencies.

**Spec:** `docs/2026-06-10-tailor-toggle-scoring-speed-design.md`

**Conventions:** Same as the main plan. Commit steps are SUGGEST-ONLY: Oleksandr's standing rule is the agent never runs `git commit`.

---

### Task 1: Config fields (`tailor`, `scoringConcurrency`)

**Files:**
- Modify: `src/config.ts`, `config.json`
- Test: `src/config.test.ts`

- [ ] **Step 1: Add failing assertions to the existing tests in `src/config.test.ts`**

In the `'applies defaults for missing fields'` test, add:

```ts
    expect(config.tailor).toBe(true);
    expect(config.scoringConcurrency).toBe(5);
```

In the `'keeps explicit values'` test, change the `writeTmpConfig` argument to include the new keys and add assertions:

```ts
    const config = loadConfig(
      writeTmpConfig({ thresholds: { hot: 90, digest: 70 }, maxJobsScoredPerRun: 10, tailor: false, scoringConcurrency: 2 }),
    );
    expect(config.thresholds).toEqual({ hot: 90, digest: 70 });
    expect(config.maxJobsScoredPerRun).toBe(10);
    expect(config.tailor).toBe(false);
    expect(config.scoringConcurrency).toBe(2);
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/config.test.ts`
Expected: FAIL — `tailor`/`scoringConcurrency` undefined.

- [ ] **Step 3: Implement in `src/config.ts`**

Add to the `Config` interface (after `maxJobsScoredPerRun: number;`):

```ts
  scoringConcurrency: number;
  tailor: boolean;
```

Add to the returned object in `loadConfig` (after the `maxJobsScoredPerRun` line):

```ts
    scoringConcurrency: raw.scoringConcurrency ?? 5,
    tailor: raw.tailor ?? true,
```

- [ ] **Step 4: Update the real `config.json`**

Add after the `"maxJobsScoredPerRun": 100,` line:

```json
  "scoringConcurrency": 5,
  "tailor": false,
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/config.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit (suggest-only)**

Suggested message: `feat: tailor toggle and scoring concurrency config fields`

---

### Task 2: `mapWithConcurrency` in `src/util.ts`

**Files:**
- Modify: `src/util.ts`
- Test: `src/util.test.ts`

- [ ] **Step 1: Add failing tests to `src/util.test.ts`**

Add `mapWithConcurrency` to the import from `'./util'` and append:

```ts
describe('mapWithConcurrency', () => {
  it('preserves order and maps all items', async () => {
    const result = await mapWithConcurrency([30, 10, 20], 2, async (n) => {
      await new Promise((resolve) => setTimeout(resolve, n));
      return n / 10;
    });
    expect(result).toEqual([3, 1, 2]);
  });

  it('never runs more than the limit concurrently', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    });
    expect(maxInFlight).toBe(3);
  });

  it('handles limit larger than item count and empty input', async () => {
    expect(await mapWithConcurrency([1], 10, async (n) => n + 1)).toEqual([2]);
    expect(await mapWithConcurrency([], 4, async () => 'x')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/util.test.ts`
Expected: FAIL — `mapWithConcurrency` not exported.

- [ ] **Step 3: Implement in `src/util.ts`**

Append:

```ts
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  // Worker pool over a shared index — safe because the event loop is single-threaded.
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/util.test.ts && npm run typecheck`
Expected: PASS (6 util tests), typecheck clean.

- [ ] **Step 5: Commit (suggest-only)**

Suggested message: `feat: mapWithConcurrency worker-pool helper`

---

### Task 3: Orchestrator — concurrent scoring, tailor gate, logging

**Files:**
- Modify: `src/run.ts`, `README.md`

- [ ] **Step 1: Edit `src/run.ts` — imports and total timer**

1. Add `mapWithConcurrency` to the existing util import (there is currently no util import in run.ts — add `import { mapWithConcurrency } from './util';` after the `./profile` import).
2. First line inside `main()`: add `const totalStart = Date.now();`

- [ ] **Step 2: Edit `src/run.ts` — replace the scoring section**

Replace everything from the `// Fix 4: snapshot retry candidates ...` comment down to the end of the retry `for` loop (currently the two sequential loops at lines 65–100) with:

```ts
    // Snapshot retry candidates BEFORE this run adds new 'seen' records.
    const retryCandidates = Object.values(state.jobs).filter((r) => r.status === 'seen' && !r.score);
    let scoringBudget = config.maxJobsScoredPerRun;
    const toScore = kept.slice(0, scoringBudget);
    scoringBudget -= toScore.length;
    if (kept.length > toScore.length) console.log(`cost cap: scoring ${toScore.length}/${kept.length}`);

    // One combined work list: fresh postings (added to state now) + retries within the same budget.
    const scoringRecords = toScore.map((posting) =>
      addJob(state, posting, fuzzyKey(posting), flaggedDe.has(posting.id) ? 'de' : undefined),
    );
    const retries = retryCandidates.slice(0, Math.max(0, scoringBudget));
    if (retryCandidates.length > retries.length) {
      console.log(`cost cap: skipping ${retryCandidates.length - retries.length} pending re-scorings`);
    }
    scoringRecords.push(...retries);

    const scoringStart = Date.now();
    let scoredOk = 0;
    let scoredFailed = 0;
    if (scoringRecords.length > 0) {
      console.log(`scoring ${scoringRecords.length} jobs (concurrency ${config.scoringConcurrency})...`);
    }
    await mapWithConcurrency(scoringRecords, config.scoringConcurrency, async (record) => {
      const jobStart = Date.now();
      try {
        record.score = scoringClient
          ? await scoreJob(scoringClient, config.models.scoring, profile, record.posting)
          : fakeScore(record.posting);
        setStatus(record, 'scored');
        scoredOk += 1;
        const seconds = ((Date.now() - jobStart) / 1000).toFixed(1);
        console.log(
          `scored ${scoredOk + scoredFailed}/${scoringRecords.length}: ${record.score.score}/100 — ${record.posting.title} @ ${record.posting.company} (${seconds}s)`,
        );
      } catch (err) {
        scoredFailed += 1;
        console.error(`scoring failed for ${record.posting.id}, will retry next run:`, err);
        // stays 'seen'; next run re-scores everything still in 'seen'.
      }
    });
    if (scoringRecords.length > 0) {
      console.log(`scoring done in ${((Date.now() - scoringStart) / 1000).toFixed(0)}s (${scoredOk} ok, ${scoredFailed} failed)`);
    }
```

(The `openai`/`scoringClient` lines above this section stay unchanged.)

- [ ] **Step 3: Edit `src/run.ts` — gate the tailor stage**

Wrap the whole tailor stage (from `const tailoringClient = ...` through the end of its `for` loop) in:

```ts
    if (config.tailor) {
      const tailoringClient = openai ? openaiTailoringClient(openai) : null;
      const date = new Date().toISOString().slice(0, 10);
      if (!dryRun) mkdirSync('matches', { recursive: true });
      for (const record of Object.values(state.jobs)) {
        const score = record.score;
        if (!score || score.score < config.thresholds.digest || record.matchFile) continue;
        if (record.status === 'archived') continue;
        const file = matchFilename(record.posting, date);
        const tailorStart = Date.now();
        try {
          const markdown = tailoringClient
            ? await tailorJob(tailoringClient, config.models.tailoring, profile, record.posting, score)
            : `# dry-run match for ${record.posting.id}\n`;
          if (!dryRun) writeFileSync(file, markdown);
          record.matchFile = file;
          console.log(`tailored: ${file} (${((Date.now() - tailorStart) / 1000).toFixed(1)}s)`);
        } catch (err) {
          console.error(`tailoring failed for ${record.posting.id}, will retry next run:`, err);
        }
      }
    } else {
      console.log('tailoring disabled (config.tailor=false)');
    }
```

(Existing per-record comments may be kept or dropped; behavior inside the loop is unchanged except the timing in the log line.)

- [ ] **Step 4: Edit `src/run.ts` — notify logs and final timing**

1. In alerts mode, capture the selection before the loop and log the count:

```ts
      const alertJobs = selectAlertJobs(state, config.thresholds.hot);
      if (alertJobs.length > 0) console.log(`sending ${alertJobs.length} alert(s)...`);
      for (const record of alertJobs) {
```

2. In digest mode, after `const digestJobs = ...`, add:

```ts
      console.log(`digest: ${digestJobs.length} match(es) in the last 24h`);
```

3. Replace the final `console.log('done');` with:

```ts
    console.log(`done in ${((Date.now() - totalStart) / 1000).toFixed(0)}s`);
```

- [ ] **Step 5: Update `README.md`**

Add a new section between "Commands" and "Schedules":

```markdown
## Tuning (config.json)

- `tailor` — `false` here by default: no cover-letter generation. Set `true`
  to generate tailored material for every new match ≥ the digest threshold
  (back-fills jobs that are still relevant on the next run).
- `scoringConcurrency` — parallel scoring calls (default 5). Raise for speed,
  lower if you hit OpenAI rate limits.
- `maxJobsScoredPerRun` — cost cap per run (default 100).
```

- [ ] **Step 6: Verify**

Run: `npm test && npm run typecheck && npm run dry-run && npx tsx src/run.ts --mode=alerts --dry-run`
Expected: all tests pass, typecheck clean, both dry-runs exit 0. Dry-run digest output must now contain: `scoring 7 jobs (concurrency 5)...`, seven `scored i/7: ...` lines, a `scoring done in 0s (7 ok, 0 failed)` line, `tailoring disabled (config.tailor=false)`, NO `tailored:` lines, NO `📄` lines in the digest block, and a final `done in Ns`. Alerts dry-run shows the two `[dry-run alert]` blocks WITHOUT `Tailored material:` lines.

- [ ] **Step 7: Commit (suggest-only)**

Suggested message: `feat: concurrent scoring with progress logs; tailoring behind config.tailor (off)`

---

## Self-review notes (done at plan-writing time)

- **Spec coverage:** §2 config decisions → Task 1; §2 concurrency impl → Task 2; §3 orchestrator changes + all log lines → Task 3 steps 2–4; §4 tests → Tasks 1–2 + Task 3 step 6 dry-run assertions; README knob docs → Task 3 step 5.
- **Type consistency:** `mapWithConcurrency(items, limit, fn)` (Task 2) matches the Task 3 call; `config.scoringConcurrency`/`config.tailor` (Task 1) match Task 3 usage; `scoringRecords` are `JobRecord[]` (return of `addJob` + `retryCandidates` filter), and the worker uses `record.posting` accordingly.
- **Behavior invariants preserved:** budget semantics identical (fresh first, retries fill remainder); per-record try/catch keeps "status advances only on success"; `addJob` runs synchronously before any await, so dedupe-by-state semantics are unchanged; tailor-disabled leaves `matchFile` unset so re-enabling back-fills.
- **Known cosmetic change:** dry-run output ordering/content changes (progress lines, no tailored lines) — Task 3 step 6 pins the new expectations.
