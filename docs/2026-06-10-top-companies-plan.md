# Weekly Top-Paying Companies List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A weekly GitHub Actions job that LLM-researches the top ~30 companies by senior-SWE total comp (Germany office or EU-remote), auto-discovers their Greenhouse/Lever/Personio boards, writes `state/companies.json`, sends a Telegram summary — and the existing watchlist source monitors those boards on every alerts/digest run.

**Architecture:** New `src/research/` module family (research → board discovery → artifact → summary), a thin `src/run-companies.ts` entrypoint, a `mergeWatchlist` hook in the existing watchlist source, and a third workflow `companies.yml`. OpenAI Responses API (`client.responses.parse`) with the `web_search` tool and `zodTextFormat` structured output — verified available in the installed `openai@6` SDK.

**Tech Stack:** Existing toolchain only — openai SDK, zod 4, vitest, tsx. No new dependencies.

**Spec:** `docs/2026-06-10-top-companies-design.md`

**Conventions:** Same as the main plan. Commit steps are SUGGEST-ONLY: Oleksandr's standing rule is the agent never runs `git commit`.

---

### Task 1: Config fields (`models.research`, `topCompanies.count`)

**Files:**
- Modify: `src/config.ts`, `config.json`
- Test: `src/config.test.ts`

- [ ] **Step 1: Add failing assertions to `src/config.test.ts`**

In the `'applies defaults for missing fields'` test, add:

```ts
    expect(config.models.research).toBe('gpt-5');
    expect(config.topCompanies).toEqual({ count: 30 });
```

In the `'keeps explicit values'` test, add `topCompanies: { count: 10 }` to the `writeTmpConfig` argument and add:

```ts
    expect(config.topCompanies).toEqual({ count: 10 });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/config.test.ts`
Expected: FAIL — `config.models.research` / `config.topCompanies` are `undefined`.

- [ ] **Step 3: Implement in `src/config.ts`**

In the `Config` interface, change the `models` line and add `topCompanies`:

```ts
  models: { scoring: string; tailoring: string; research: string };
  topCompanies: { count: number };
```

In `loadConfig`, change the `models` line and add `topCompanies` after it:

```ts
    models: { scoring: 'gpt-5-mini', tailoring: 'gpt-5', research: 'gpt-5', ...raw.models },
    topCompanies: { count: 30, ...raw.topCompanies },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/config.test.ts`
Expected: PASS

- [ ] **Step 5: Update shipped `config.json`**

Change the `models` line and add `topCompanies` after it:

```json
  "models": { "scoring": "gpt-5-mini", "tailoring": "gpt-5", "research": "gpt-5" },
  "topCompanies": { "count": 30 },
```

- [ ] **Step 6: Typecheck, then suggest commit**

Run: `npm run typecheck` — expected: clean.
Suggested commit: `feat: add research model and topCompanies config`

---

### Task 2: Companies artifact module

**Files:**
- Create: `src/research/companies-file.ts`
- Test: `src/research/companies-file.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/research/companies-file.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  emptyCompaniesFile, loadCompaniesFile, saveCompaniesFile, type CompaniesFile,
} from './companies-file';

const sample: CompaniesFile = {
  updatedAt: '2026-06-10T05:00:00.000Z',
  companies: [
    {
      name: 'Stripe',
      reason: 'Top-of-market comp for EU-remote seniors.',
      estSeniorTotalCompEur: 210000,
      germanyPresence: 'remote-eu',
      board: { vendor: 'greenhouse', slug: 'stripe' },
    },
    {
      name: 'Google Germany',
      reason: 'Highest Munich total comp.',
      estSeniorTotalCompEur: 200000,
      germanyPresence: 'office',
      board: null,
    },
  ],
};

describe('companies file', () => {
  it('returns an empty file when the path does not exist', () => {
    const loaded = loadCompaniesFile(join(tmpdir(), 'job-scout-nope', 'companies.json'));
    expect(loaded).toEqual(emptyCompaniesFile());
    expect(loaded.companies).toEqual([]);
  });

  it('round-trips save and load', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'job-scout-')), 'companies.json');
    saveCompaniesFile(path, sample);
    expect(loadCompaniesFile(path)).toEqual(sample);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/research/companies-file.test.ts`
Expected: FAIL — cannot find module `./companies-file`.

- [ ] **Step 3: Implement `src/research/companies-file.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const COMPANIES_PATH = 'state/companies.json';

export type BoardVendor = 'greenhouse' | 'lever' | 'personio';

export interface CompanyBoard {
  vendor: BoardVendor;
  slug: string;
}

export interface CompanyEntry {
  name: string;
  reason: string;
  estSeniorTotalCompEur: number;
  germanyPresence: 'office' | 'remote-eu';
  board: CompanyBoard | null;
}

export interface CompaniesFile {
  updatedAt: string;
  companies: CompanyEntry[];
}

export function emptyCompaniesFile(): CompaniesFile {
  return { updatedAt: new Date(0).toISOString(), companies: [] };
}

export function loadCompaniesFile(path: string): CompaniesFile {
  if (!existsSync(path)) return emptyCompaniesFile();
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<CompaniesFile>;
  return { ...emptyCompaniesFile(), ...parsed };
}

export function saveCompaniesFile(path: string, file: CompaniesFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/research/companies-file.test.ts`
Expected: PASS

- [ ] **Step 5: Suggest commit**

Suggested commit: `feat: add companies artifact module`

---

### Task 3: LLM research module

**Files:**
- Create: `src/research/top-companies.ts`
- Test: `src/research/top-companies.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/research/top-companies.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildResearchPrompt, researchTopCompanies, TopCompaniesSchema,
  type ResearchClient, type TopCompanies,
} from './top-companies';

const valid: TopCompanies = {
  companies: [
    {
      name: 'Stripe',
      reason: 'Top-of-market comp for EU-remote seniors.',
      estSeniorTotalCompEur: 210000,
      germanyPresence: 'remote-eu',
      ats: { vendor: 'greenhouse', slugGuesses: ['stripe'] },
    },
  ],
};

function stubClient(output: TopCompanies | null): ResearchClient & { lastArgs?: unknown } {
  const client: ResearchClient & { lastArgs?: unknown } = {
    parse: async (args) => {
      client.lastArgs = args;
      return { output_parsed: output };
    },
  };
  return client;
}

describe('TopCompaniesSchema', () => {
  it('accepts a valid payload', () => {
    expect(TopCompaniesSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an unknown germanyPresence', () => {
    const bad = {
      companies: [{ ...valid.companies[0], germanyPresence: 'mars' }],
    };
    expect(() => TopCompaniesSchema.parse(bad)).toThrow();
  });
});

describe('researchTopCompanies', () => {
  it('passes model, web_search tool, and the count in the prompt', async () => {
    const client = stubClient(valid);
    await researchTopCompanies(client, 'gpt-5', 30);
    const args = client.lastArgs as { model: string; input: string; tools: { type: string }[] };
    expect(args.model).toBe('gpt-5');
    expect(args.tools).toEqual([{ type: 'web_search' }]);
    expect(args.input).toContain('30');
  });

  it('returns the parsed companies', async () => {
    await expect(researchTopCompanies(stubClient(valid), 'gpt-5', 30)).resolves.toEqual(valid.companies);
  });

  it('throws when parsing returned null', async () => {
    await expect(researchTopCompanies(stubClient(null), 'gpt-5', 30)).rejects.toThrow(/no companies/);
  });

  it('throws when the list is empty', async () => {
    await expect(researchTopCompanies(stubClient({ companies: [] }), 'gpt-5', 30)).rejects.toThrow(/no companies/);
  });
});

describe('buildResearchPrompt', () => {
  it('mentions Germany, EU-remote, and the ATS vendors', () => {
    const prompt = buildResearchPrompt(25);
    expect(prompt).toContain('25');
    expect(prompt).toContain('Germany');
    expect(prompt).toContain('greenhouse');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/research/top-companies.test.ts`
Expected: FAIL — cannot find module `./top-companies`.

- [ ] **Step 3: Implement `src/research/top-companies.ts`**

```ts
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

export const ResearchedCompanySchema = z.object({
  name: z.string().min(1),
  reason: z.string(),
  estSeniorTotalCompEur: z.number().min(0),
  germanyPresence: z.enum(['office', 'remote-eu']),
  ats: z.object({
    vendor: z.enum(['greenhouse', 'lever', 'personio', 'other', 'unknown']),
    slugGuesses: z.array(z.string()),
  }),
});

export const TopCompaniesSchema = z.object({
  companies: z.array(ResearchedCompanySchema),
});

export type ResearchedCompany = z.infer<typeof ResearchedCompanySchema>;
export type TopCompanies = z.infer<typeof TopCompaniesSchema>;

// Minimal structural slice of the OpenAI client so tests can stub it.
export interface ResearchClient {
  parse(args: {
    model: string;
    input: string;
    tools: { type: 'web_search' }[];
    format: ReturnType<typeof zodTextFormat>;
  }): Promise<{ output_parsed: TopCompanies | null }>;
}

export function openaiResearchClient(client: OpenAI): ResearchClient {
  return {
    parse: async (args) => {
      const response = await client.responses.parse({
        model: args.model,
        input: args.input,
        tools: args.tools,
        text: { format: args.format },
      });
      return { output_parsed: response.output_parsed as TopCompanies | null };
    },
  };
}

export function buildResearchPrompt(count: number): string {
  return [
    'You research employers for a senior software engineer based in Germany.',
    `List the top ${count} technology companies (big tech, scale-ups, fintech/trading included) by realistic TOTAL compensation (base + bonus + equity) for senior/staff software engineers, that either:`,
    '(a) have an engineering office in Germany, or',
    '(b) are established companies that hire engineers fully remote from Germany under an EU-remote policy.',
    'Use web search to ground the list in current data: levels.fyi, Glassdoor/Kununu, recent salary reports and news. Rank by estimated senior-engineer total comp in EUR, highest first.',
    '',
    'For each company report:',
    '- name: official company name.',
    '- reason: ONE sentence on why it pays top of market.',
    '- estSeniorTotalCompEur: estimated annual senior-engineer total comp in EUR.',
    "- germanyPresence: 'office' (engineering office in Germany) or 'remote-eu' (hires remote from Germany).",
    "- ats: which applicant tracking system its careers page uses — vendor 'greenhouse' (job-boards.greenhouse.io/{slug}), 'lever' (jobs.lever.co/{slug}) or 'personio' ({slug}.jobs.personio.de); 'other' or 'unknown' otherwise. slugGuesses: likely board slugs, most likely first (lowercase, no spaces).",
  ].join('\n');
}

export async function researchTopCompanies(
  client: ResearchClient,
  model: string,
  count: number,
): Promise<ResearchedCompany[]> {
  const response = await client.parse({
    model,
    input: buildResearchPrompt(count),
    tools: [{ type: 'web_search' }],
    format: zodTextFormat(TopCompaniesSchema, 'top_companies'),
  });
  const parsed = response.output_parsed;
  if (!parsed || parsed.companies.length === 0) {
    throw new Error('research: no companies returned');
  }
  return parsed.companies;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/research/top-companies.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck, then suggest commit**

Run: `npm run typecheck` — expected: clean.
Suggested commit: `feat: add LLM web-research module for top companies`

---

### Task 4: Research fixture + dry-run loader

**Files:**
- Create: `fixtures/top-companies.json`
- Modify: `src/dry-run.ts`
- Test: `src/dry-run.test.ts`

- [ ] **Step 1: Create `fixtures/top-companies.json`**

```json
{
  "companies": [
    {
      "name": "Stripe",
      "reason": "Top-of-market US-style comp for EU-remote senior engineers.",
      "estSeniorTotalCompEur": 210000,
      "germanyPresence": "remote-eu",
      "ats": { "vendor": "greenhouse", "slugGuesses": ["stripe"] }
    },
    {
      "name": "Google Germany",
      "reason": "L5 total comp in Munich is among the highest in the country.",
      "estSeniorTotalCompEur": 200000,
      "germanyPresence": "office",
      "ats": { "vendor": "other", "slugGuesses": [] }
    },
    {
      "name": "Datadog",
      "reason": "Equity-heavy packages, hires EU-remote.",
      "estSeniorTotalCompEur": 180000,
      "germanyPresence": "remote-eu",
      "ats": { "vendor": "greenhouse", "slugGuesses": ["datadog"] }
    },
    {
      "name": "Celonis",
      "reason": "Munich decacorn with aggressive senior comp bands.",
      "estSeniorTotalCompEur": 150000,
      "germanyPresence": "office",
      "ats": { "vendor": "unknown", "slugGuesses": [] }
    },
    {
      "name": "Personio",
      "reason": "Munich scale-up paying top-quartile senior salaries.",
      "estSeniorTotalCompEur": 140000,
      "germanyPresence": "office",
      "ats": { "vendor": "personio", "slugGuesses": ["personio"] }
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

Add to `src/dry-run.test.ts`:

```ts
import { loadFixtureCompanies } from './dry-run';

describe('loadFixtureCompanies', () => {
  it('loads schema-valid researched companies', () => {
    const companies = loadFixtureCompanies();
    expect(companies.length).toBeGreaterThanOrEqual(5);
    expect(companies[0]?.name).toBe('Stripe');
  });
});
```

(Merge the import with the file's existing `./dry-run` import if there is one.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/dry-run.test.ts`
Expected: FAIL — `loadFixtureCompanies` is not exported.

- [ ] **Step 4: Implement in `src/dry-run.ts`**

Add the import and function:

```ts
import { TopCompaniesSchema, type ResearchedCompany } from './research/top-companies';

export function loadFixtureCompanies(): ResearchedCompany[] {
  // Schema-parse so the fixture is validated against the live schema.
  return TopCompaniesSchema.parse(fixture('top-companies')).companies;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/dry-run.test.ts`
Expected: PASS

- [ ] **Step 6: Suggest commit**

Suggested commit: `feat: add top-companies fixture and dry-run loader`

---

### Task 5: Slug variants + board-name matching

**Files:**
- Create: `src/research/verify-boards.ts`
- Test: `src/research/verify-boards.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/research/verify-boards.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { namesMatch, slugVariants } from './verify-boards';

describe('slugVariants', () => {
  it('puts LLM guesses first, then collapsed and dashed name forms', () => {
    expect(slugVariants('Trade Republic', ['traderepublic'])).toEqual([
      'traderepublic',
      'trade-republic',
    ]);
  });

  it('folds umlauts and strips punctuation', () => {
    expect(slugVariants('Müller & Söhne GmbH', [])).toEqual([
      'mullersohnegmbh',
      'muller-sohne-gmbh',
    ]);
  });

  it('drops invalid guesses and dedupes, capped at 6', () => {
    const variants = slugVariants('Acme', ['ACME', 'acme!!', 'a', 'b', 'c', 'd', 'e']);
    expect(variants[0]).toBe('acme');
    expect(variants).not.toContain('acme!!');
    expect(variants.length).toBeLessThanOrEqual(6);
    expect(new Set(variants).size).toBe(variants.length);
  });
});

describe('namesMatch', () => {
  it('matches when one normalized name contains the other', () => {
    expect(namesMatch('Stripe, Inc.', 'Stripe')).toBe(true);
    expect(namesMatch('Datadog', 'Datadog Germany')).toBe(true);
  });

  it('rejects unrelated names and empty strings', () => {
    expect(namesMatch('Initech', 'Stripe')).toBe(false);
    expect(namesMatch('', 'Stripe')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/research/verify-boards.test.ts`
Expected: FAIL — cannot find module `./verify-boards`.

- [ ] **Step 3: Implement the two functions in `src/research/verify-boards.ts`**

```ts
function foldAscii(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

// Candidate slugs: LLM guesses first (most likely), then name-derived forms. Capped at 6.
export function slugVariants(name: string, guesses: string[]): string[] {
  const ascii = foldAscii(name);
  const collapsed = ascii.replace(/[^a-z0-9]/g, '');
  const dashed = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const all = [...guesses.map((g) => g.trim().toLowerCase()), collapsed, dashed];
  const valid = all.filter((v) => /^[a-z0-9][a-z0-9-]*$/.test(v));
  return [...new Set(valid)].slice(0, 6);
}

// Guards against slug collisions: the board must plausibly belong to the company.
export function namesMatch(boardName: string, companyName: string): boolean {
  const a = foldAscii(boardName).replace(/[^a-z0-9]/g, '');
  const b = foldAscii(companyName).replace(/[^a-z0-9]/g, '');
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/research/verify-boards.test.ts`
Expected: PASS. Note: `slugVariants('Acme', [...])` test expects 'a', 'b', 'c' etc. to be kept as valid single-char slugs but capped — if the cap assertion fails, the list is `['acme', 'a', 'b', 'c', 'd', 'e']` which is exactly 6; the test only asserts ≤ 6 and dedupe, so it passes.

- [ ] **Step 5: Suggest commit**

Suggested commit: `feat: add slug variants and board-name matching`

---

### Task 6: Board discovery with probes, cache, wipe-out detection

**Files:**
- Modify: `src/research/verify-boards.ts`
- Test: `src/research/verify-boards.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/research/verify-boards.test.ts` (extend the existing imports):

```ts
import { buildBoardCache, discoverBoards, type ProbeFn } from './verify-boards';
import type { CompaniesFile } from './companies-file';
import type { ResearchedCompany } from './top-companies';

function company(name: string, vendor: ResearchedCompany['ats']['vendor'], guesses: string[]): ResearchedCompany {
  return {
    name,
    reason: 'r',
    estSeniorTotalCompEur: 100000,
    germanyPresence: 'office',
    ats: { vendor, slugGuesses: guesses },
  };
}

describe('buildBoardCache', () => {
  it('maps lowercased names to verified boards, skipping board-less entries', () => {
    const previous: CompaniesFile = {
      updatedAt: '2026-06-03T05:00:00.000Z',
      companies: [
        { name: 'Stripe', reason: 'r', estSeniorTotalCompEur: 1, germanyPresence: 'remote-eu', board: { vendor: 'greenhouse', slug: 'stripe' } },
        { name: 'Celonis', reason: 'r', estSeniorTotalCompEur: 1, germanyPresence: 'office', board: null },
      ],
    };
    expect(buildBoardCache(previous)).toEqual({ stripe: { vendor: 'greenhouse', slug: 'stripe' } });
  });
});

describe('discoverBoards', () => {
  it('uses the cache without probing', async () => {
    let probed = 0;
    const probe: ProbeFn = async () => {
      probed += 1;
      return 'miss';
    };
    const cache = { stripe: { vendor: 'greenhouse', slug: 'stripe' } as const };
    const [entry] = await discoverBoards([company('Stripe', 'greenhouse', ['stripe'])], cache, probe);
    expect(entry?.board).toEqual({ vendor: 'greenhouse', slug: 'stripe' });
    expect(probed).toBe(0);
  });

  it('probes the claimed vendor first and stops at the first hit', async () => {
    const calls: string[] = [];
    const probe: ProbeFn = async (vendor, slug) => {
      calls.push(`${vendor}:${slug}`);
      return vendor === 'lever' && slug === 'acme' ? 'hit' : 'miss';
    };
    const [entry] = await discoverBoards([company('Acme', 'lever', ['acme'])], {}, probe);
    expect(entry?.board).toEqual({ vendor: 'lever', slug: 'acme' });
    expect(calls[0]).toBe('lever:acme');
  });

  it('returns board null when nothing verifies', async () => {
    const probe: ProbeFn = async () => 'miss';
    const [entry] = await discoverBoards([company('Acme', 'unknown', [])], {}, probe);
    expect(entry?.board).toBeNull();
  });

  it('throws when every probe errors (network wipe-out)', async () => {
    const probe: ProbeFn = async () => 'error';
    await expect(discoverBoards([company('Acme', 'unknown', [])], {}, probe)).rejects.toThrow(/probes errored/);
  });

  it('does not throw when some probes miss normally', async () => {
    const probe: ProbeFn = async (vendor) => (vendor === 'personio' ? 'error' : 'miss');
    const [entry] = await discoverBoards([company('Acme', 'unknown', [])], {}, probe);
    expect(entry?.board).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/research/verify-boards.test.ts`
Expected: FAIL — `buildBoardCache` / `discoverBoards` not exported.

- [ ] **Step 3: Implement in `src/research/verify-boards.ts`**

Add imports at the top of the file:

```ts
import { mapWithConcurrency } from '../util';
import type { BoardVendor, CompaniesFile, CompanyBoard, CompanyEntry } from './companies-file';
import type { ResearchedCompany } from './top-companies';
```

Append:

```ts
export type ProbeResult = 'hit' | 'miss' | 'error';
export type ProbeFn = (vendor: BoardVendor, slug: string, company: string) => Promise<ProbeResult>;

async function probeGreenhouse(slug: string, company: string): Promise<boolean> {
  const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}`);
  if (!res.ok) return false;
  const body = (await res.json()) as { name?: string };
  return namesMatch(body.name ?? '', company);
}

async function probeLever(slug: string): Promise<boolean> {
  const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json&limit=1`);
  if (!res.ok) return false;
  return Array.isArray(await res.json());
}

async function probePersonio(slug: string): Promise<boolean> {
  const res = await fetch(`https://${slug}.jobs.personio.de/search.json`);
  return res.ok;
}

// 'error' (thrown fetch, e.g. DNS/network) is tracked separately from a clean 'miss'
// so a total network wipe-out can fail the run instead of silently emptying the list.
export const defaultProbe: ProbeFn = async (vendor, slug, company) => {
  try {
    if (vendor === 'greenhouse') return (await probeGreenhouse(slug, company)) ? 'hit' : 'miss';
    if (vendor === 'lever') return (await probeLever(slug)) ? 'hit' : 'miss';
    return (await probePersonio(slug)) ? 'hit' : 'miss';
  } catch {
    return 'error';
  }
};

export function buildBoardCache(previous: CompaniesFile): Record<string, CompanyBoard> {
  const cache: Record<string, CompanyBoard> = {};
  for (const c of previous.companies) {
    if (c.board) cache[c.name.toLowerCase()] = c.board;
  }
  return cache;
}

const VENDORS: BoardVendor[] = ['greenhouse', 'lever', 'personio'];

export async function discoverBoards(
  companies: ResearchedCompany[],
  cache: Record<string, CompanyBoard>,
  probe: ProbeFn = defaultProbe,
): Promise<CompanyEntry[]> {
  let hits = 0;
  let misses = 0;
  let errors = 0;
  const entries = await mapWithConcurrency(companies, 5, async (c): Promise<CompanyEntry> => {
    const base = {
      name: c.name,
      reason: c.reason,
      estSeniorTotalCompEur: c.estSeniorTotalCompEur,
      germanyPresence: c.germanyPresence,
    };
    const cached = cache[c.name.toLowerCase()];
    if (cached) return { ...base, board: cached };
    const slugs = slugVariants(c.name, c.ats.slugGuesses);
    const claimed = VENDORS.find((v) => v === c.ats.vendor);
    const vendors = claimed ? [claimed, ...VENDORS.filter((v) => v !== claimed)] : VENDORS;
    for (const vendor of vendors) {
      for (const slug of slugs) {
        const result = await probe(vendor, slug, c.name);
        if (result === 'hit') {
          hits += 1;
          return { ...base, board: { vendor, slug } };
        }
        if (result === 'miss') misses += 1;
        else errors += 1;
      }
    }
    return { ...base, board: null };
  });
  if (errors > 0 && hits === 0 && misses === 0) {
    throw new Error(`board discovery: all ${errors} probes errored (network?)`);
  }
  return entries;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/research/verify-boards.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck, then suggest commit**

Run: `npm run typecheck` — expected: clean.
Suggested commit: `feat: add ATS board discovery with probe cache and wipe-out guard`

---

### Task 7: Week-over-week diff + Telegram summary

**Files:**
- Create: `src/research/summary.ts`
- Test: `src/research/summary.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/research/summary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CompaniesFile, CompanyEntry } from './companies-file';
import { diffCompanies, formatCompaniesMessage } from './summary';

function entry(name: string, board: CompanyEntry['board'] = null): CompanyEntry {
  return { name, reason: 'r', estSeniorTotalCompEur: 150000, germanyPresence: 'office', board };
}

function file(...companies: CompanyEntry[]): CompaniesFile {
  return { updatedAt: '2026-06-10T05:00:00.000Z', companies };
}

describe('diffCompanies', () => {
  it('reports added and dropped names, case-insensitively', () => {
    const previous = file(entry('Stripe'), entry('Celonis'));
    const current = file(entry('stripe'), entry('Datadog'));
    expect(diffCompanies(previous, current)).toEqual({ added: ['Datadog'], dropped: ['Celonis'] });
  });

  it('is empty for identical lists', () => {
    const f = file(entry('Stripe'));
    expect(diffCompanies(f, f)).toEqual({ added: [], dropped: [] });
  });
});

describe('formatCompaniesMessage', () => {
  it('lists ranked companies with comp, presence, and board', () => {
    const current = file(entry('Stripe', { vendor: 'greenhouse', slug: 'stripe' }), entry('Celonis'));
    const message = formatCompaniesMessage(current, { added: ['Stripe'], dropped: ['Initech'] });
    expect(message).toContain('2 companies');
    expect(message).toContain('1. Stripe — ~€150k (office, greenhouse:stripe)');
    expect(message).toContain('2. Celonis — ~€150k (office, no board found)');
    expect(message).toContain('➕ New: Stripe');
    expect(message).toContain('➖ Dropped: Initech');
    expect(message).toContain('1 without a discoverable job board');
  });

  it('omits diff and no-board lines when empty', () => {
    const current = file(entry('Stripe', { vendor: 'greenhouse', slug: 'stripe' }));
    const message = formatCompaniesMessage(current, { added: [], dropped: [] });
    expect(message).not.toContain('➕');
    expect(message).not.toContain('➖');
    expect(message).not.toContain('without a discoverable');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/research/summary.test.ts`
Expected: FAIL — cannot find module `./summary`.

- [ ] **Step 3: Implement `src/research/summary.ts`**

```ts
import type { CompaniesFile } from './companies-file';

export interface CompaniesDiff {
  added: string[];
  dropped: string[];
}

export function diffCompanies(previous: CompaniesFile, current: CompaniesFile): CompaniesDiff {
  const prevNames = new Set(previous.companies.map((c) => c.name.toLowerCase()));
  const currNames = new Set(current.companies.map((c) => c.name.toLowerCase()));
  return {
    added: current.companies.filter((c) => !prevNames.has(c.name.toLowerCase())).map((c) => c.name),
    dropped: previous.companies.filter((c) => !currNames.has(c.name.toLowerCase())).map((c) => c.name),
  };
}

export function formatCompaniesMessage(current: CompaniesFile, diff: CompaniesDiff): string {
  const lines = [`🏆 Top-paying companies updated — ${current.companies.length} companies`];
  current.companies.forEach((c, i) => {
    const board = c.board ? `${c.board.vendor}:${c.board.slug}` : 'no board found';
    lines.push(`${i + 1}. ${c.name} — ~€${Math.round(c.estSeniorTotalCompEur / 1000)}k (${c.germanyPresence}, ${board})`);
  });
  if (diff.added.length > 0) lines.push(`➕ New: ${diff.added.join(', ')}`);
  if (diff.dropped.length > 0) lines.push(`➖ Dropped: ${diff.dropped.join(', ')}`);
  const noBoard = current.companies.filter((c) => !c.board).length;
  if (noBoard > 0) lines.push(`⚠️ ${noBoard} without a discoverable job board (covered by broad searches only)`);
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/research/summary.test.ts`
Expected: PASS

- [ ] **Step 5: Suggest commit**

Suggested commit: `feat: add companies diff and telegram summary formatting`

---

### Task 8: Watchlist merges generated companies

**Files:**
- Modify: `src/sources/watchlist.ts`, `src/sources/index.ts`
- Test: `src/sources/watchlist.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/sources/watchlist.test.ts`:

```ts
import type { CompaniesFile } from '../research/companies-file';
import { mergeWatchlist } from './watchlist';

describe('mergeWatchlist', () => {
  const manual = { greenhouse: ['acme'], lever: [], personio: ['initech'] };

  function generated(...boards: ({ vendor: 'greenhouse' | 'lever' | 'personio'; slug: string } | null)[]): CompaniesFile {
    return {
      updatedAt: '2026-06-10T05:00:00.000Z',
      companies: boards.map((board, i) => ({
        name: `Company ${i}`,
        reason: 'r',
        estSeniorTotalCompEur: 1,
        germanyPresence: 'office' as const,
        board,
      })),
    };
  }

  it('adds generated boards to the manual lists', () => {
    const merged = mergeWatchlist(manual, generated({ vendor: 'greenhouse', slug: 'stripe' }, { vendor: 'lever', slug: 'n26' }));
    expect(merged).toEqual({ greenhouse: ['acme', 'stripe'], lever: ['n26'], personio: ['initech'] });
  });

  it('dedupes slugs already present manually and skips board-less companies', () => {
    const merged = mergeWatchlist(manual, generated({ vendor: 'greenhouse', slug: 'acme' }, null));
    expect(merged).toEqual(manual);
  });

  it('does not mutate the manual config', () => {
    mergeWatchlist(manual, generated({ vendor: 'greenhouse', slug: 'stripe' }));
    expect(manual.greenhouse).toEqual(['acme']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/sources/watchlist.test.ts`
Expected: FAIL — `mergeWatchlist` not exported.

- [ ] **Step 3: Implement `mergeWatchlist` and wire it into `fetchWatchlist`**

In `src/sources/watchlist.ts`, add to the imports:

```ts
import { emptyCompaniesFile, type CompaniesFile } from '../research/companies-file';
```

Add above `fetchWatchlist`:

```ts
export interface WatchlistSlugs {
  greenhouse: string[];
  lever: string[];
  personio: string[];
}

// Generated boards (state/companies.json) extend — never replace — the manual config lists.
export function mergeWatchlist(manual: WatchlistSlugs, generated: CompaniesFile): WatchlistSlugs {
  const merged: WatchlistSlugs = {
    greenhouse: [...manual.greenhouse],
    lever: [...manual.lever],
    personio: [...manual.personio],
  };
  for (const c of generated.companies) {
    if (!c.board) continue;
    const list = merged[c.board.vendor];
    if (!list.includes(c.board.slug)) list.push(c.board.slug);
  }
  return merged;
}
```

Change the `fetchWatchlist` signature and replace the three `config.watchlist.*` references with the merged lists:

```ts
export async function fetchWatchlist(
  config: Config,
  generated: CompaniesFile = emptyCompaniesFile(),
): Promise<JobPosting[]> {
  const watchlist = mergeWatchlist(config.watchlist, generated);
  const tasks: { label: string; fn: () => Promise<JobPosting[]> }[] = [
    ...watchlist.greenhouse.map((slug) => ({
```

(and likewise `watchlist.lever.map(...)` and `watchlist.personio.map(...)` — the task bodies are unchanged.)

- [ ] **Step 4: Wire the companies file into `buildSourceTasks` in `src/sources/index.ts`**

Add to the imports:

```ts
import { COMPANIES_PATH, loadCompaniesFile } from '../research/companies-file';
```

Change the watchlist line:

```ts
  if (config.sources.watchlist) tasks.push({ name: 'watchlist', fn: () => fetchWatchlist(config, loadCompaniesFile(COMPANIES_PATH)) });
```

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS / clean — existing watchlist and sources tests still pass (default parameter keeps old call sites valid).

- [ ] **Step 6: Suggest commit**

Suggested commit: `feat: merge generated top-companies boards into watchlist source`

---

### Task 9: `run-companies` entrypoint + npm scripts

**Files:**
- Create: `src/run-companies.ts`
- Modify: `package.json`

- [ ] **Step 1: Create `src/run-companies.ts`**

```ts
import OpenAI from 'openai';
import { loadConfig } from './config';
import { loadFixtureCompanies } from './dry-run';
import { sendTelegram } from './pipeline/notify';
import {
  COMPANIES_PATH, emptyCompaniesFile, loadCompaniesFile, saveCompaniesFile, type CompaniesFile,
} from './research/companies-file';
import { diffCompanies, formatCompaniesMessage } from './research/summary';
import { openaiResearchClient, researchTopCompanies } from './research/top-companies';
import { buildBoardCache, discoverBoards, type ProbeFn } from './research/verify-boards';

// Deterministic dry-run probe: fixture companies with these boards "exist".
const fakeProbe: ProbeFn = async (vendor, slug) =>
  (vendor === 'greenhouse' && ['stripe', 'datadog'].includes(slug)) ||
  (vendor === 'personio' && slug === 'personio')
    ? 'hit'
    : 'miss';

async function main(): Promise<void> {
  const totalStart = Date.now();
  const dryRun = process.argv.includes('--dry-run');
  const config = loadConfig();

  const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  const chatId = process.env.TELEGRAM_CHAT_ID ?? '';
  if (!dryRun && (!token || !chatId)) {
    throw new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set');
  }

  const previous = dryRun ? emptyCompaniesFile() : loadCompaniesFile(COMPANIES_PATH);

  // 1. Research. Any failure here or in discovery aborts before the artifact
  //    is written, so last week's file survives a bad run.
  const researched = dryRun
    ? loadFixtureCompanies()
    : await researchTopCompanies(openaiResearchClient(new OpenAI()), config.models.research, config.topCompanies.count);
  console.log(`researched ${researched.length} companies`);

  // 2. Verify boards
  const entries = await discoverBoards(researched, buildBoardCache(previous), dryRun ? fakeProbe : undefined);
  entries.sort((a, b) => b.estSeniorTotalCompEur - a.estSeniorTotalCompEur);
  console.log(`boards verified: ${entries.filter((e) => e.board).length}/${entries.length}`);

  // 3. Persist
  const current: CompaniesFile = { updatedAt: new Date().toISOString(), companies: entries };
  if (!dryRun) saveCompaniesFile(COMPANIES_PATH, current);

  // 4. Notify
  const message = formatCompaniesMessage(current, diffCompanies(previous, current));
  if (dryRun) console.log('[dry-run companies]\n' + message);
  else await sendTelegram(token, chatId, message);

  console.log(`done in ${((Date.now() - totalStart) / 1000).toFixed(0)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add npm scripts to `package.json`**

In `"scripts"`, after the `"dry-run"` line, add:

```json
    "companies": "tsx src/run-companies.ts",
    "companies:dry-run": "tsx src/run-companies.ts --dry-run"
```

- [ ] **Step 3: Verify the dry run end-to-end**

Run: `npm run companies:dry-run`
Expected output (exact ranking from the fixture):

```
researched 5 companies
boards verified: 3/5
[dry-run companies]
🏆 Top-paying companies updated — 5 companies
1. Stripe — ~€210k (remote-eu, greenhouse:stripe)
2. Google Germany — ~€200k (office, no board found)
3. Datadog — ~€180k (remote-eu, greenhouse:datadog)
4. Celonis — ~€150k (office, no board found)
5. Personio — ~€140k (office, personio:personio)
➕ New: Stripe, Google Germany, Datadog, Celonis, Personio
⚠️ 2 without a discoverable job board (covered by broad searches only)
done in 0s
```

- [ ] **Step 4: Run full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: PASS / clean.

- [ ] **Step 5: Suggest commit**

Suggested commit: `feat: add weekly top-companies entrypoint and dry run`

---

### Task 10: Weekly GitHub Actions workflow

**Files:**
- Create: `.github/workflows/companies.yml`

- [ ] **Step 1: Create `.github/workflows/companies.yml`**

```yaml
name: companies
on:
  schedule:
    # Mon 07:00 Berlin (summer). Winter: 06:00 — accepted.
    - cron: '0 5 * * 1'
  workflow_dispatch:

concurrency:
  group: job-scout
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  companies:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run companies
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
      - name: Commit state
        # A failed run writes nothing (the artifact is only saved on success),
        # so this commits exactly when there is a fresh companies.json.
        if: always()
        run: |
          git config user.name "job-scout-bot"
          git config user.email "job-scout-bot@users.noreply.github.com"
          git add state
          git diff --cached --quiet || git commit -m "chore: companies update [skip ci]"
          git pull --rebase origin main
          git push
```

- [ ] **Step 2: Review against `digest.yml`**

There is no YAML linter in the repo; the check is a side-by-side read against
`.github/workflows/digest.yml`. Confirm: same `concurrency` group (`job-scout`),
same commit-state pattern, `npm test` runs before the real command, and only the
three secrets this job needs (`OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID` — no Adzuna/RapidAPI).

- [ ] **Step 3: Suggest commit**

Suggested commit: `feat: add weekly companies workflow`

---

### Task 11: README + final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the feature in `README.md`**

In the `## Commands` section, add after the `dry-run` line:

```markdown
- `npm run companies` / `npm run companies:dry-run` — weekly top-paying
  companies research (see below)
```

In the `## Tuning (config.json)` section, add:

```markdown
- `topCompanies.count` — size of the weekly top-paying companies list
  (default 30). `models.research` — model used for the weekly research run.
```

In the `## Schedules` section, add:

```markdown
- companies: 07:00 Berlin Mondays — LLM web research refreshes
  `state/companies.json` (top companies by senior-SWE total comp, Germany
  office or EU-remote); verified Greenhouse/Lever/Personio boards are
  monitored by every alerts/digest run alongside the manual `watchlist`.
```

- [ ] **Step 2: Full verification**

Run: `npx vitest run && npm run typecheck && npm run companies:dry-run && npm run dry-run`
Expected: all tests pass, typecheck clean, both dry runs print their summaries (the digest dry run confirms the watchlist wiring didn't break the main pipeline).

- [ ] **Step 3: Suggest commit**

Suggested commit: `docs: document weekly top-companies job`

---

## Verification checklist (post-implementation)

- [ ] `npx vitest run` — all green
- [ ] `npm run typecheck` — clean
- [ ] `npm run companies:dry-run` — prints the 5-company fixture summary, writes nothing
- [ ] `npm run dry-run` — main pipeline unaffected
- [ ] First real run: trigger `companies` via workflow_dispatch, confirm Telegram message and `state/companies.json` commit, then check the next digest picks up watchlist postings from a discovered board
