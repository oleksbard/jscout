# Scoring & Filter Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encode the real search criteria — TS/React/Node senior+ or hands-on EM, no onsite anywhere, hybrid Berlin-only, EU-only remote, €100k salary floor — in both the hard filter and the scoring rubric.

**Architecture:** `matchesLocation` is rewritten to the new truth table with the non-EU drop list expanded and moved ahead of the mode rules (Berlin-mention exemption keeps multi-office postings); a pure `meetsSalaryFloor` joins `hardFilter` driven by a new `minSalaryEur` config; the scoring system prompt gets the new role/location/salary rubric lines.

**Tech Stack:** Existing toolchain only.

**Spec:** `docs/2026-06-10-scoring-tuning-design.md`

**Conventions:** Same as the main plan. Commit steps are SUGGEST-ONLY: Oleksandr's standing rule is the agent never runs `git commit`.

---

### Task 1: Config — `minSalaryEur`

**Files:**
- Modify: `src/config.ts`, `config.json`
- Test: `src/config.test.ts`

- [ ] **Step 1: Add failing assertions in `src/config.test.ts`**

In the `'applies defaults for missing fields'` test add:

```ts
    expect(config.minSalaryEur).toBe(0);
```

In the `'keeps explicit values'` test, add `minSalaryEur: 100000` to the `writeTmpConfig` object and assert:

```ts
    expect(config.minSalaryEur).toBe(100000);
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/config.test.ts`
Expected: FAIL — minSalaryEur undefined.

- [ ] **Step 3: Implement in `src/config.ts`**

Add to the `Config` interface after `tailor: boolean;`:

```ts
  minSalaryEur: number;
```

Add to the returned object in `loadConfig` after the `tailor` line:

```ts
    minSalaryEur: raw.minSalaryEur ?? 0,
```

- [ ] **Step 4: Update `config.json`** — add after the `"tailor": false,` line:

```json
  "minSalaryEur": 100000,
```

- [ ] **Step 5: Verify**

Run: `npx vitest run src/config.test.ts && npm run typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit (suggest-only)**

Suggested message: `feat: minSalaryEur config field (salary floor, shipped 100k)`

---

### Task 2: Hard filter — location truth table + salary floor

**Files:**
- Modify: `src/pipeline/filter.ts`
- Test: `src/pipeline/filter.test.ts`

- [ ] **Step 1: Rewrite the location tests and add salary tests in `src/pipeline/filter.test.ts`**

1. Add `meetsSalaryFloor` to the import from `'./filter'`.
2. In the `config` stub at the top, add `minSalaryEur: 0` inside the object literal (before the `as Pick<...>` cast) and widen the Pick: `as Pick<Config, 'titleInclude' | 'titleExclude' | 'minSalaryEur'> as Config`.
3. REPLACE the entire `describe('matchesLocation', ...)` block (all four existing `it`s, including the old `'accepts Berlin regardless of work mode'`, `'accepts hybrid only in Germany'`, `'rejects onsite outside Berlin, keeps unknown mode in Germany'`, and `'rejects explicitly non-EU remote locations'`) with:

```ts
describe('matchesLocation', () => {
  it('drops onsite everywhere, including Berlin', () => {
    expect(matchesLocation(posting({ location: 'Berlin', workMode: 'onsite' }))).toBe(false);
    expect(matchesLocation(posting({ location: 'Hamburg', workMode: 'onsite' }))).toBe(false);
  });

  it('accepts EU-wide remote, rejects clearly non-EU remote', () => {
    expect(matchesLocation(posting({ location: 'Remote, Europe', workMode: 'remote' }))).toBe(true);
    expect(matchesLocation(posting({ location: '', workMode: 'remote' }))).toBe(true);
    expect(matchesLocation(posting({ location: 'New York, USA', workMode: 'remote' }))).toBe(false);
    expect(matchesLocation(posting({ location: 'Remote, Singapore', workMode: 'remote' }))).toBe(false);
    expect(matchesLocation(posting({ location: 'Remote, Switzerland', workMode: 'remote' }))).toBe(false);
  });

  it('accepts hybrid only in Berlin', () => {
    expect(matchesLocation(posting({ location: 'Berlin, Germany', workMode: 'hybrid' }))).toBe(true);
    expect(matchesLocation(posting({ location: 'Munich, Germany', workMode: 'hybrid' }))).toBe(false);
    expect(matchesLocation(posting({ location: 'Berlin or New York, USA', workMode: 'hybrid' }))).toBe(true);
  });

  it('keeps unknown work mode only in Berlin', () => {
    expect(matchesLocation(posting({ location: 'Berlin', workMode: 'unknown' }))).toBe(true);
    expect(matchesLocation(posting({ location: 'Hamburg', workMode: 'unknown' }))).toBe(false);
    expect(matchesLocation(posting({ location: 'Madrid', workMode: 'unknown' }))).toBe(false);
  });
});
```

4. Append after the `detectGerman` describe:

```ts
describe('meetsSalaryFloor', () => {
  it('passes when no salary stated or no floor configured', () => {
    expect(meetsSalaryFloor(undefined, 100000)).toBe(true);
    expect(meetsSalaryFloor('75000–90000', 0)).toBe(true);
  });

  it('compares the max of the stated range against the floor', () => {
    expect(meetsSalaryFloor('75000–90000', 100000)).toBe(false);
    expect(meetsSalaryFloor('95000–120000', 100000)).toBe(true);
  });

  it('passes non-numeric salary strings through', () => {
    expect(meetsSalaryFloor('competitive', 100000)).toBe(true);
  });
});
```

5. In the `describe('hardFilter', ...)` block, the existing test stays (its postings carry no salary), and add:

```ts
  it('drops postings below the salary floor when configured', () => {
    const cheap = posting({ id: 'x:cheap', salary: '60000–80000' });
    const rich = posting({ id: 'x:rich', salary: '90000–130000' });
    const { kept } = hardFilter([cheap, rich], { ...config, minSalaryEur: 100000 });
    expect(kept.map((p) => p.id)).toEqual(['x:rich']);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pipeline/filter.test.ts`
Expected: FAIL — meetsSalaryFloor not exported; new location expectations fail against old rules.

- [ ] **Step 3: Implement in `src/pipeline/filter.ts`**

1. Replace `NON_EU_HINTS` with:

```ts
const NON_EU_HINTS = [
  ' usa', 'united states', 'u.s.', 'north america', 'latin america',
  'canada', 'united kingdom', 'australia', 'new zealand', 'india',
  'switzerland', 'singapore', 'japan', 'china', 'uae', 'dubai', 'israel',
  'brazil', 'mexico', 'asia', 'apac', 'africa', 'middle east',
];
```

2. Replace `matchesLocation` with:

```ts
export function matchesLocation(p: JobPosting): boolean {
  const loc = ` ${p.location.toLowerCase()} `;
  const inBerlin = loc.includes('berlin');
  // Clearly non-EU — unless Berlin is one of the listed offices (multi-office postings).
  if (!inBerlin && NON_EU_HINTS.some((h) => loc.includes(h))) return false;
  const inEu = p.location === '' || EU_HINTS.some((h) => loc.includes(h));
  if (p.workMode === 'onsite') return false; // onsite: never, anywhere
  if (p.workMode === 'remote') return inEu; // remote: EU-wide
  if (p.workMode === 'hybrid') return inBerlin; // hybrid: Berlin only
  return inBerlin; // unknown mode: Berlin only — elsewhere it's almost certainly a local role
}
```

(The `inGermany` local and its use disappear; `GERMANY_HINTS` stays — it still seeds `EU_HINTS`.)

3. Add after `matchesLocation`:

```ts
export function meetsSalaryFloor(salary: string | undefined, floorEur: number): boolean {
  if (!salary || floorEur <= 0) return true;
  const numbers = (salary.match(/\d+(?:[.,]\d+)*/g) ?? [])
    .map((raw) => Number(raw.replace(/[.,](?=\d{3}(?:\D|$))/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (numbers.length === 0) return true;
  const max = Math.max(...numbers);
  return (max < 1000 ? max * 1000 : max) >= floorEur; // "75–90" style means thousands
}
```

4. In `hardFilter`, change the `kept` filter line to:

```ts
  const kept = postings.filter(
    (p) => matchesTitle(p.title, config) && matchesLocation(p) && meetsSalaryFloor(p.salary, config.minSalaryEur),
  );
```

- [ ] **Step 4: Verify**

Run: `npx vitest run src/pipeline/filter.test.ts && npm run typecheck && npm test`
Expected: filter tests pass; full suite green. NOTE: `npm test` is expected to stay green — no other test reads the location rules.

- [ ] **Step 5: Commit (suggest-only)**

Suggested message: `feat: tighten location rules (no onsite, Berlin-only hybrid) and add salary floor`

---

### Task 3: Scoring rubric + README

**Files:**
- Modify: `src/pipeline/score.ts`, `README.md`
- Test: `src/pipeline/score.test.ts`

- [ ] **Step 1: Add failing assertions in `src/pipeline/score.test.ts`**

In the `'puts profile in the stable system prompt and the job in the user turn'` test, add:

```ts
    expect(messages[0]?.content).toContain('hands-on Engineering Manager');
    expect(messages[0]?.content).toContain('hybrid in Berlin');
    expect(messages[0]?.content).toContain('€100,000');
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pipeline/score.test.ts`
Expected: FAIL on the three new assertions.

- [ ] **Step 3: Update the rubric in `src/pipeline/score.ts`**

In `buildScoringMessages`, replace these two lines of the system prompt array:

```ts
        'In-scope roles: Senior Frontend (React/TS), Senior Full-stack (TS/Node), Staff/Lead/Principal Engineer, Engineering Manager.',
        'Location scope: remote (EU, hireable from Germany), remote/hybrid in Germany, or Berlin onsite/hybrid.',
```

with these four:

```ts
        'In-scope roles: Senior+ Frontend or Full-stack Engineer working with TypeScript, React and Node.js; Staff/Lead/Principal on that stack; hands-on Engineering Manager (still coding) on that stack.',
        'Out of scope: pure people-management EM roles, and roles centered on other stacks (e.g. Java, .NET, PHP, Python-only, mobile).',
        'Location scope: remote (EU, hireable from Germany) or hybrid in Berlin. Onsite-only roles are out of scope — score below 40.',
        'Salary: if the posting states total compensation below €100,000/year, score below 60. Unstated salary is neutral.',
```

(All other lines, including the injection guard, stay.)

- [ ] **Step 4: Update `README.md`** — in the "Tuning (config.json)" section add:

```markdown
- `minSalaryEur` — drop jobs whose stated salary range tops out below this
  (default 0 = off; set to 100000 here). Unstated salaries pass; the scorer
  judges salaries mentioned only in the posting text.
```

- [ ] **Step 5: Verify everything**

Run: `npm test && npm run typecheck && npm run dry-run && npx tsx src/run.ts --mode=alerts --dry-run`
Expected: all tests pass, typecheck clean, both dry-runs exit 0. Dry-run digest now shows `after hard filter: 6` (was 7 — the Adzuna fixture is Hamburg+hybrid, dropped by the Berlin-only hybrid rule; its sub-100k salary would also drop it) and `scoring 6 jobs (concurrency 5)...`; digest block still lists 3 matches; alerts dry-run still shows 2 alert blocks.

- [ ] **Step 6: Commit (suggest-only)**

Suggested message: `feat: scoring rubric for TS/React/Node senior+ and hands-on EM, salary floor`

---

## Self-review notes (done at plan-writing time)

- **Spec coverage:** §2 location rules + non-EU expansion → Task 2; salary floor config/function/integration → Tasks 1–2; rubric → Task 3; README → Task 3; testing table → Tasks 1–3 test steps; "old scores untouched" needs no code.
- **Type consistency:** `meetsSalaryFloor(salary: string | undefined, floorEur: number)` matches `hardFilter`'s call with `p.salary`/`config.minSalaryEur`; `minSalaryEur` defined in Task 1 before Task 2 uses it; test stub widened to include it.
- **Cross-checks done:** dry-run fixture trace — adzuna drops (Hamburg hybrid → Berlin-only rule; salary 90k max would also fail the floor); greenhouse was already title-dropped before this change; the remaining 6 fixture postings still pass the new location rules (arbeitnow Berlin/remote, remoteok Europe/remote, jsearch Berlin DE/remote, hn 'Berlin or Remote (EU)'/remote, greenhouse 'Berlin, Germany'/unknown, lever 'Remote - Germany'/remote, personio Berlin/unknown). The old `'Berlin or New York, USA' onsite → true` expectation is intentionally replaced by the hybrid variant (onsite is now always false).
