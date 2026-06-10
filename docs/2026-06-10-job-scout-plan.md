# Job Scout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript pipeline on GitHub Actions that discovers software-developer job postings (EU/Germany), AI-scores them against a personal profile with a cheap OpenAI model, generates tailored application material with a stronger model, and delivers Telegram alerts + a daily digest.

**Architecture:** Linear staged pipeline (`fetch → dedupe → hard filter → score → tailor → notify`) run by cron. State is a committed JSON file in the repo; each stage is a small pure-ish module; network/LLM clients are thin wrappers around pure, fixture-tested normalizers and formatters.

**Tech Stack:** Node 22 (built-in `fetch`), TypeScript (ESM, bundler resolution), `tsx`, `vitest`, `openai` SDK + `zod` structured outputs, Telegram Bot API, GitHub Actions cron.

**Spec:** `docs/2026-06-10-job-scout-design.md`

**Project location:** `~/projects/jscout` (new private repo — NOT bunch-platform). All commands below run from that directory.

**Conventions for every task:**
- Tests are colocated: `src/<area>/<module>.test.ts`.
- Run a single test file: `npx vitest run src/<area>/<module>.test.ts`. Run all: `npm test`.
- Commit after each green task. (Executor note: confirm with Oleksandr whether the agent may run `git commit` in this repo, or only suggest messages — his standing preference elsewhere is suggest-only.)

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `src/smoke.test.ts`

- [ ] **Step 1: Create the project and git repo**

```bash
mkdir -p ~/projects/jscout && cd ~/projects/jscout && git init
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "job-scout",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "alerts": "tsx src/run.ts --mode=alerts",
    "digest": "tsx src/run.ts --mode=digest",
    "dry-run": "tsx src/run.ts --mode=digest --dry-run"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
npm install openai zod
npm install -D typescript tsx vitest @types/node
```

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Write `.gitignore`**

```
node_modules/
.env
```

- [ ] **Step 6: Write a smoke test `src/smoke.test.ts`**

```ts
import { describe, expect, it } from 'vitest';

describe('toolchain', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Verify toolchain**

Run: `npm test && npm run typecheck`
Expected: 1 test passes; typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold job-scout (ts, vitest, openai sdk)"
```

---

### Task 2: Core types, shared util, config loader

**Files:**
- Create: `src/types.ts`, `src/util.ts`, `src/config.ts`, `config.json`
- Test: `src/config.test.ts`, `src/util.test.ts`

- [ ] **Step 1: Write `src/types.ts`**

```ts
export type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'unknown';

export interface JobPosting {
  id: string; // `${source}:${sourceId}`
  source: string;
  url: string;
  title: string;
  company: string;
  location: string; // raw location text, '' if unknown
  workMode: WorkMode;
  description: string; // plain text
  postedAt: string; // ISO 8601
  salary?: string;
}

export type JobStatus = 'seen' | 'scored' | 'alerted' | 'digested' | 'archived';

export interface ScoreResult {
  score: number;
  stackFit: number;
  seniorityFit: number;
  locationFit: number;
  reasoning: string;
  language: 'en' | 'de' | 'other';
}

export interface JobRecord {
  posting: JobPosting;
  fuzzyKey: string;
  status: JobStatus;
  score?: ScoreResult;
  matchFile?: string;
  languageFlag?: 'de';
  firstSeenAt: string;
  updatedAt: string;
}

export interface State {
  jobs: Record<string, JobRecord>;
  sourceFailures: Record<string, { consecutiveFailures: number; lastError: string }>;
}
```

- [ ] **Step 2: Write the failing util test `src/util.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { stripHtml } from './util';

describe('stripHtml', () => {
  it('strips tags and collapses whitespace', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>\n<ul><li>x</li></ul>')).toBe('Hello world x');
  });

  it('decodes common entities', () => {
    expect(stripHtml('R&amp;D &lt;team&gt;')).toBe('R&D <team>');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/util.test.ts`
Expected: FAIL — `stripHtml` not found.

- [ ] **Step 4: Write `src/util.ts`**

```ts
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
```

- [ ] **Step 5: Write the failing config test `src/config.test.ts`**

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

function writeTmpConfig(json: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'job-scout-'));
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(json));
  return path;
}

describe('loadConfig', () => {
  it('applies defaults for missing fields', () => {
    const config = loadConfig(writeTmpConfig({}));
    expect(config.thresholds).toEqual({ hot: 80, digest: 60 });
    expect(config.maxJobsScoredPerRun).toBe(100);
    expect(config.models.scoring).toBeTruthy();
    expect(config.watchlist).toEqual({ greenhouse: [], lever: [], personio: [] });
  });

  it('keeps explicit values', () => {
    const config = loadConfig(writeTmpConfig({ thresholds: { hot: 90, digest: 70 }, maxJobsScoredPerRun: 10 }));
    expect(config.thresholds).toEqual({ hot: 90, digest: 70 });
    expect(config.maxJobsScoredPerRun).toBe(10);
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run src/config.test.ts`
Expected: FAIL — `loadConfig` not found.

- [ ] **Step 7: Write `src/config.ts`**

```ts
import { readFileSync } from 'node:fs';

export interface Config {
  thresholds: { hot: number; digest: number };
  maxJobsScoredPerRun: number;
  models: { scoring: string; tailoring: string };
  searchTerms: string[];
  titleInclude: string[];
  titleExclude: string[];
  watchlist: { greenhouse: string[]; lever: string[]; personio: string[] };
  sources: Record<string, boolean>;
}

export function loadConfig(path = 'config.json'): Config {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Config>;
  return {
    thresholds: { hot: 80, digest: 60, ...raw.thresholds },
    maxJobsScoredPerRun: raw.maxJobsScoredPerRun ?? 100,
    // Model ids are config-only — verify current OpenAI model names/pricing before first real run.
    models: { scoring: 'gpt-5-mini', tailoring: 'gpt-5', ...raw.models },
    searchTerms: raw.searchTerms ?? [],
    titleInclude: raw.titleInclude ?? [],
    titleExclude: raw.titleExclude ?? [],
    watchlist: { greenhouse: [], lever: [], personio: [], ...raw.watchlist },
    sources: raw.sources ?? {},
  };
}
```

- [ ] **Step 8: Write the real `config.json` at repo root**

```json
{
  "thresholds": { "hot": 80, "digest": 60 },
  "maxJobsScoredPerRun": 100,
  "models": { "scoring": "gpt-5-mini", "tailoring": "gpt-5" },
  "searchTerms": ["frontend developer", "fullstack developer", "react developer", "typescript", "engineering manager"],
  "titleInclude": ["frontend", "front-end", "front end", "fullstack", "full-stack", "full stack", "react", "typescript", "web developer", "software engineer", "software developer", "staff engineer", "principal engineer", "tech lead", "engineering lead", "engineering manager", "head of engineering"],
  "titleExclude": ["intern", "working student", "werkstudent", "recruiter", "sales", "marketing", "wordpress", "php", "salesforce", "sap", "drupal"],
  "watchlist": { "greenhouse": [], "lever": [], "personio": [] },
  "sources": { "arbeitnow": true, "remoteok": true, "adzuna": true, "hnWhoIsHiring": true, "jsearch": true, "watchlist": true }
}
```

- [ ] **Step 9: Run all tests + typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS (3 test files).

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: core types, util, config loader with defaults"
```

---

### Task 3: State store

**Files:**
- Create: `src/pipeline/state.ts`
- Test: `src/pipeline/state.test.ts`

- [ ] **Step 1: Write the failing test `src/pipeline/state.test.ts`**

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { JobPosting } from '../types';
import { addJob, emptyState, loadState, saveState, setStatus } from './state';

const posting: JobPosting = {
  id: 'arbeitnow:abc',
  source: 'arbeitnow',
  url: 'https://example.com/job',
  title: 'Senior Frontend Engineer',
  company: 'Acme GmbH',
  location: 'Berlin',
  workMode: 'hybrid',
  description: 'React and TypeScript role',
  postedAt: '2026-06-10T00:00:00.000Z',
};

describe('state store', () => {
  it('returns empty state when file does not exist', () => {
    const state = loadState(join(tmpdir(), 'does-not-exist', 'jobs.json'));
    expect(state).toEqual(emptyState());
  });

  it('round-trips state through disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'job-scout-state-'));
    const path = join(dir, 'state', 'jobs.json');
    const state = emptyState();
    addJob(state, posting, 'acme|senior frontend engineer', 'de');
    saveState(path, state);
    const loaded = loadState(path);
    expect(loaded.jobs['arbeitnow:abc']?.status).toBe('seen');
    expect(loaded.jobs['arbeitnow:abc']?.languageFlag).toBe('de');
    expect(loaded.jobs['arbeitnow:abc']?.fuzzyKey).toBe('acme|senior frontend engineer');
  });

  it('setStatus advances status and bumps updatedAt', () => {
    const state = emptyState();
    const record = addJob(state, posting, 'k');
    const before = record.updatedAt;
    setStatus(record, 'scored');
    expect(record.status).toBe('scored');
    expect(record.updatedAt >= before).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pipeline/state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/pipeline/state.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { JobPosting, JobRecord, JobStatus, State } from '../types';

export function emptyState(): State {
  return { jobs: {}, sourceFailures: {} };
}

export function loadState(path: string): State {
  if (!existsSync(path)) return emptyState();
  return JSON.parse(readFileSync(path, 'utf8')) as State;
}

export function saveState(path: string, state: State): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
}

export function addJob(state: State, posting: JobPosting, fuzzyKey: string, languageFlag?: 'de'): JobRecord {
  const now = new Date().toISOString();
  const record: JobRecord = {
    posting,
    fuzzyKey,
    status: 'seen',
    firstSeenAt: now,
    updatedAt: now,
    ...(languageFlag ? { languageFlag } : {}),
  };
  state.jobs[posting.id] = record;
  return record;
}

export function setStatus(record: JobRecord, status: JobStatus): void {
  record.status = status;
  record.updatedAt = new Date().toISOString();
}

export function recordSourceFailure(state: State, source: string, error: string): void {
  const prev = state.sourceFailures[source];
  state.sourceFailures[source] = {
    consecutiveFailures: (prev?.consecutiveFailures ?? 0) + 1,
    lastError: error,
  };
}

export function clearSourceFailure(state: State, source: string): void {
  delete state.sourceFailures[source];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/pipeline/state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: state store with status machine and source-failure tracking"
```

---

### Task 4: Dedupe

**Files:**
- Create: `src/pipeline/dedupe.ts`
- Test: `src/pipeline/dedupe.test.ts`

- [ ] **Step 1: Write the failing test `src/pipeline/dedupe.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { JobPosting } from '../types';
import { addJob, emptyState } from './state';
import { dedupe, fuzzyKey } from './dedupe';

function posting(overrides: Partial<JobPosting>): JobPosting {
  return {
    id: 'src:1',
    source: 'src',
    url: 'https://example.com',
    title: 'Senior Frontend Engineer (m/w/d)',
    company: 'Acme GmbH',
    location: 'Berlin',
    workMode: 'remote',
    description: 'desc',
    postedAt: '2026-06-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('fuzzyKey', () => {
  it('normalizes company suffixes and gender markers', () => {
    expect(fuzzyKey(posting({}))).toBe('acme|senior frontend engineer');
    expect(fuzzyKey(posting({ company: 'ACME Inc.', title: 'Senior Frontend Engineer (f/m/d)' }))).toBe(
      'acme|senior frontend engineer',
    );
  });
});

describe('dedupe', () => {
  it('drops postings already known by id or fuzzy key', () => {
    const state = emptyState();
    const known = posting({ id: 'adzuna:7' });
    addJob(state, known, fuzzyKey(known));

    const fresh = posting({ id: 'jsearch:9', company: 'Other Co', title: 'Platform Engineer' });
    const dupById = posting({ id: 'adzuna:7', company: 'X', title: 'Y' });
    const dupByKey = posting({ id: 'jsearch:8', company: 'Acme Inc', title: 'Senior Frontend Engineer (f/m/d)' });

    expect(dedupe([fresh, dupById, dupByKey], state)).toEqual([fresh]);
  });

  it('drops duplicates within the same batch', () => {
    const state = emptyState();
    const a = posting({ id: 'a:1' });
    const b = posting({ id: 'b:1' }); // same company+title from another source
    expect(dedupe([a, b], state)).toEqual([a]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pipeline/dedupe.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/pipeline/dedupe.ts`**

```ts
import type { JobPosting, State } from '../types';

const TITLE_NOISE = /\((?:m\/w\/d|f\/m\/d|w\/m\/d|m\/f\/d|d\/f\/m|all genders?)\)/gi;
const COMPANY_SUFFIXES = /\b(gmbh|ag|se|inc|ltd|llc|ug|kg|co|corp|company)\b/g;

function normalize(text: string, extra?: RegExp): string {
  let t = text.toLowerCase().replace(TITLE_NOISE, '');
  if (extra) t = t.replace(extra, ' ');
  return t
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function fuzzyKey(posting: Pick<JobPosting, 'company' | 'title'>): string {
  const company = normalize(posting.company.toLowerCase().replace(COMPANY_SUFFIXES, ' '));
  const title = normalize(posting.title);
  return `${company}|${title}`;
}

export function dedupe(postings: JobPosting[], state: State): JobPosting[] {
  const knownIds = new Set(Object.keys(state.jobs));
  const knownKeys = new Set(Object.values(state.jobs).map((j) => j.fuzzyKey));
  const result: JobPosting[] = [];
  for (const p of postings) {
    const key = fuzzyKey(p);
    if (knownIds.has(p.id) || knownKeys.has(key)) continue;
    knownIds.add(p.id);
    knownKeys.add(key);
    result.push(p);
  }
  return result;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/pipeline/dedupe.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: dedupe by source id and cross-source fuzzy key"
```

---

### Task 5: Hard filter (title, location, German detection)

**Files:**
- Create: `src/pipeline/filter.ts`
- Test: `src/pipeline/filter.test.ts`

- [ ] **Step 1: Write the failing test `src/pipeline/filter.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { Config } from '../config';
import type { JobPosting } from '../types';
import { detectGerman, hardFilter, matchesLocation, matchesTitle } from './filter';

const config = {
  titleInclude: ['frontend', 'react', 'engineering manager'],
  titleExclude: ['intern', 'php'],
} as Pick<Config, 'titleInclude' | 'titleExclude'> as Config;

function posting(overrides: Partial<JobPosting>): JobPosting {
  return {
    id: 'x:1',
    source: 'x',
    url: 'https://example.com',
    title: 'Senior Frontend Engineer',
    company: 'Acme',
    location: 'Berlin, Germany',
    workMode: 'remote',
    description: 'We build things with React and TypeScript.',
    postedAt: '2026-06-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('matchesTitle', () => {
  it('accepts included keywords, rejects excluded ones', () => {
    expect(matchesTitle('Senior Frontend Engineer', config)).toBe(true);
    expect(matchesTitle('Engineering Manager', config)).toBe(true);
    expect(matchesTitle('Frontend Intern', config)).toBe(false);
    expect(matchesTitle('Senior PHP Developer', config)).toBe(false);
    expect(matchesTitle('Accountant', config)).toBe(false);
  });
});

describe('matchesLocation', () => {
  it('accepts Berlin regardless of work mode', () => {
    expect(matchesLocation(posting({ location: 'Berlin', workMode: 'onsite' }))).toBe(true);
  });

  it('accepts EU-wide remote, rejects non-EU remote', () => {
    expect(matchesLocation(posting({ location: 'Remote, Europe', workMode: 'remote' }))).toBe(true);
    expect(matchesLocation(posting({ location: '', workMode: 'remote' }))).toBe(true);
    expect(matchesLocation(posting({ location: 'New York, USA', workMode: 'remote' }))).toBe(false);
  });

  it('accepts hybrid only in Germany', () => {
    expect(matchesLocation(posting({ location: 'Munich, Germany', workMode: 'hybrid' }))).toBe(true);
    expect(matchesLocation(posting({ location: 'Paris, France', workMode: 'hybrid' }))).toBe(false);
  });

  it('rejects onsite outside Berlin, keeps unknown mode in Germany', () => {
    expect(matchesLocation(posting({ location: 'Hamburg', workMode: 'onsite' }))).toBe(false);
    expect(matchesLocation(posting({ location: 'Hamburg', workMode: 'unknown' }))).toBe(true);
    expect(matchesLocation(posting({ location: 'Madrid', workMode: 'unknown' }))).toBe(false);
  });
});

describe('detectGerman', () => {
  it('flags German text and passes English text', () => {
    const de =
      'Wir suchen eine erfahrene Person für unser Team. Deine Aufgaben sind vielfältig und wir bieten dir flexible Arbeitszeiten. Erfahrung mit React und gute Kenntnisse sind wichtig. Du arbeitest mit der besten Technologie und die Kollegen sind nett.';
    const en = 'We are looking for an experienced engineer to join our team building React applications.';
    expect(detectGerman(de)).toBe(true);
    expect(detectGerman(en)).toBe(false);
  });
});

describe('hardFilter', () => {
  it('keeps matching postings and flags German ones', () => {
    const good = posting({ id: 'x:good' });
    const wrongTitle = posting({ id: 'x:title', title: 'Sales Manager' });
    const wrongLoc = posting({ id: 'x:loc', location: 'Boston, USA', workMode: 'onsite' });
    const german = posting({
      id: 'x:de',
      description:
        'Wir suchen für unser Team eine erfahrene Person. Deine Aufgaben und deine Erfahrung mit React sind wichtig, gute Kenntnisse und die Arbeit mit der Plattform.',
    });
    const { kept, flaggedDe } = hardFilter([good, wrongTitle, wrongLoc, german], config);
    expect(kept.map((p) => p.id)).toEqual(['x:good', 'x:de']);
    expect(flaggedDe.has('x:de')).toBe(true);
    expect(flaggedDe.has('x:good')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pipeline/filter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/pipeline/filter.ts`**

```ts
import type { Config } from '../config';
import type { JobPosting } from '../types';

const GERMANY_HINTS = [
  'germany', 'deutschland', 'berlin', 'munich', 'münchen', 'hamburg', 'cologne', 'köln', 'frankfurt',
  'stuttgart', 'düsseldorf', 'leipzig', 'dresden', 'bremen', 'hannover', 'nuremberg', 'nürnberg', 'karlsruhe',
];

const EU_HINTS = [
  ...GERMANY_HINTS,
  'austria', 'netherlands', 'poland', 'france', 'spain', 'portugal', 'italy', 'ireland', 'belgium',
  'denmark', 'sweden', 'finland', 'czech', 'estonia', 'latvia', 'lithuania', 'greece', 'romania',
  'bulgaria', 'croatia', 'hungary', 'slovakia', 'slovenia', 'luxembourg', 'europe', ' eu', 'emea', 'remote',
];

export function matchesTitle(title: string, config: Config): boolean {
  const t = title.toLowerCase();
  if (config.titleExclude.some((k) => t.includes(k))) return false;
  return config.titleInclude.some((k) => t.includes(k));
}

export function matchesLocation(p: JobPosting): boolean {
  const loc = ` ${p.location.toLowerCase()} `;
  const inGermany = GERMANY_HINTS.some((h) => loc.includes(h));
  const inEu = p.location === '' || EU_HINTS.some((h) => loc.includes(h));
  if (loc.includes('berlin')) return true; // Berlin: any work mode
  if (p.workMode === 'remote') return inEu; // remote: EU-wide
  if (p.workMode === 'hybrid') return inGermany; // hybrid: Germany only
  if (p.workMode === 'onsite') return false; // onsite outside Berlin: drop
  return inGermany; // unknown mode: keep German postings, scorer judges the rest
}

const GERMAN_MARKERS = [
  ' und ', ' der ', ' die ', ' das ', ' für ', ' mit ', ' wir ', ' du ', ' deine ', ' nicht ',
  ' erfahrung', ' kenntnisse', ' aufgaben', ' arbeit', ' team ', ' suchen ',
];

export function detectGerman(text: string): boolean {
  const sample = ` ${text.toLowerCase().slice(0, 2000)} `;
  const hits = GERMAN_MARKERS.filter((m) => sample.includes(m)).length;
  return hits >= 5;
}

export function hardFilter(
  postings: JobPosting[],
  config: Config,
): { kept: JobPosting[]; flaggedDe: Set<string> } {
  const kept = postings.filter((p) => matchesTitle(p.title, config) && matchesLocation(p));
  const flaggedDe = new Set(kept.filter((p) => detectGerman(p.description)).map((p) => p.id));
  return { kept, flaggedDe };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/pipeline/filter.test.ts`
Expected: PASS. (`' team '` and `' du '` appear in English too — if `detectGerman` misfires on the English sample, raise the threshold to 6 rather than weakening markers.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: hard filter for title, location rules, German detection"
```

---

### Task 6: Sources — Arbeitnow + RemoteOK

**Files:**
- Create: `src/sources/arbeitnow.ts`, `src/sources/remoteok.ts`, `fixtures/arbeitnow.json`, `fixtures/remoteok.json`
- Test: `src/sources/arbeitnow.test.ts`, `src/sources/remoteok.test.ts`

Fixtures mirror each API's documented response shape; refresh them with real captures later (`curl <api-url> | jq` and trim to 2–3 items).

- [ ] **Step 1: Write `fixtures/arbeitnow.json`**

```json
{
  "data": [
    {
      "slug": "senior-frontend-engineer-acme-berlin",
      "company_name": "Acme GmbH",
      "title": "Senior Frontend Engineer (m/w/d)",
      "description": "<p>We build with <b>React</b> and TypeScript.</p>",
      "remote": true,
      "url": "https://www.arbeitnow.com/jobs/companies/acme/senior-frontend-engineer",
      "tags": ["React", "TypeScript"],
      "job_types": ["full-time"],
      "location": "Berlin",
      "created_at": 1765400000
    }
  ]
}
```

- [ ] **Step 2: Write the failing test `src/sources/arbeitnow.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/arbeitnow.json';
import { normalizeArbeitnow } from './arbeitnow';

describe('normalizeArbeitnow', () => {
  it('maps API payload to JobPosting', () => {
    const [job] = normalizeArbeitnow(fixture);
    expect(job).toEqual({
      id: 'arbeitnow:senior-frontend-engineer-acme-berlin',
      source: 'arbeitnow',
      url: 'https://www.arbeitnow.com/jobs/companies/acme/senior-frontend-engineer',
      title: 'Senior Frontend Engineer (m/w/d)',
      company: 'Acme GmbH',
      location: 'Berlin',
      workMode: 'remote',
      description: 'We build with React and TypeScript.',
      postedAt: new Date(1765400000 * 1000).toISOString(),
    });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/sources/arbeitnow.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `src/sources/arbeitnow.ts`**

```ts
import type { JobPosting } from '../types';
import { stripHtml } from '../util';

export interface ArbeitnowResponse {
  data: {
    slug: string;
    company_name: string;
    title: string;
    description: string;
    remote: boolean;
    url: string;
    location: string;
    created_at: number;
  }[];
}

export function normalizeArbeitnow(payload: ArbeitnowResponse): JobPosting[] {
  return payload.data.map((j) => ({
    id: `arbeitnow:${j.slug}`,
    source: 'arbeitnow',
    url: j.url,
    title: j.title,
    company: j.company_name,
    location: j.location ?? '',
    workMode: j.remote ? ('remote' as const) : ('unknown' as const),
    description: stripHtml(j.description),
    postedAt: new Date(j.created_at * 1000).toISOString(),
  }));
}

export async function fetchArbeitnow(): Promise<JobPosting[]> {
  const res = await fetch('https://www.arbeitnow.com/api/job-board-api');
  if (!res.ok) throw new Error(`arbeitnow: HTTP ${res.status}`);
  return normalizeArbeitnow((await res.json()) as ArbeitnowResponse);
}
```

- [ ] **Step 5: Write `fixtures/remoteok.json`**

(First array element is RemoteOK's legal notice — the normalizer must skip entries without `position`.)

```json
[
  { "legal": "API terms..." },
  {
    "id": "123456",
    "slug": "remote-senior-react-developer-acme",
    "company": "Acme",
    "position": "Senior React Developer",
    "description": "<p>Remote-first team in Europe.</p>",
    "location": "Europe",
    "url": "https://remoteok.com/remote-jobs/123456",
    "date": "2026-06-09T12:00:00+00:00",
    "tags": ["react", "typescript"]
  }
]
```

- [ ] **Step 6: Write the failing test `src/sources/remoteok.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/remoteok.json';
import { normalizeRemoteok } from './remoteok';

describe('normalizeRemoteok', () => {
  it('skips the legal-notice entry and maps jobs', () => {
    const jobs = normalizeRemoteok(fixture as unknown[]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: 'remoteok:123456',
      source: 'remoteok',
      title: 'Senior React Developer',
      company: 'Acme',
      location: 'Europe',
      workMode: 'remote',
      url: 'https://remoteok.com/remote-jobs/123456',
    });
    expect(jobs[0]?.description).toBe('Remote-first team in Europe.');
  });
});
```

- [ ] **Step 7: Run to verify failure**

Run: `npx vitest run src/sources/remoteok.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Write `src/sources/remoteok.ts`**

```ts
import type { JobPosting } from '../types';
import { stripHtml } from '../util';

interface RemoteokJob {
  id: string | number;
  company: string;
  position: string;
  description: string;
  location: string;
  url: string;
  date: string;
}

function isJob(entry: unknown): entry is RemoteokJob {
  return typeof entry === 'object' && entry !== null && 'position' in entry;
}

export function normalizeRemoteok(payload: unknown[]): JobPosting[] {
  return payload.filter(isJob).map((j) => ({
    id: `remoteok:${j.id}`,
    source: 'remoteok',
    url: j.url,
    title: j.position,
    company: j.company,
    location: j.location ?? '',
    workMode: 'remote' as const, // RemoteOK lists remote jobs only
    description: stripHtml(j.description ?? ''),
    postedAt: new Date(j.date).toISOString(),
  }));
}

export async function fetchRemoteok(): Promise<JobPosting[]> {
  const res = await fetch('https://remoteok.com/api', {
    headers: { 'user-agent': 'job-scout (personal job search)' },
  });
  if (!res.ok) throw new Error(`remoteok: HTTP ${res.status}`);
  return normalizeRemoteok((await res.json()) as unknown[]);
}
```

- [ ] **Step 9: Run both tests + typecheck**

Run: `npx vitest run src/sources && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: arbeitnow and remoteok sources with fixture-tested normalizers"
```

---

### Task 7: Sources — Adzuna + JSearch (keyed APIs)

**Files:**
- Create: `src/sources/adzuna.ts`, `src/sources/jsearch.ts`, `fixtures/adzuna.json`, `fixtures/jsearch.json`
- Test: `src/sources/adzuna.test.ts`, `src/sources/jsearch.test.ts`

- [ ] **Step 1: Write `fixtures/adzuna.json`**

```json
{
  "results": [
    {
      "id": "987654",
      "title": "Senior Fullstack Developer (React/Node)",
      "company": { "display_name": "Beta Tech GmbH" },
      "location": { "display_name": "Hamburg, Deutschland" },
      "description": "Hybrid role: 2 days office. React, Node, TypeScript.",
      "redirect_url": "https://www.adzuna.de/land/ad/987654",
      "created": "2026-06-09T08:00:00Z",
      "salary_min": 75000,
      "salary_max": 90000
    }
  ]
}
```

- [ ] **Step 2: Write the failing test `src/sources/adzuna.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/adzuna.json';
import { normalizeAdzuna } from './adzuna';

describe('normalizeAdzuna', () => {
  it('maps results, infers workMode from description, formats salary', () => {
    const [job] = normalizeAdzuna(fixture);
    expect(job).toMatchObject({
      id: 'adzuna:987654',
      source: 'adzuna',
      title: 'Senior Fullstack Developer (React/Node)',
      company: 'Beta Tech GmbH',
      location: 'Hamburg, Deutschland',
      workMode: 'hybrid',
      url: 'https://www.adzuna.de/land/ad/987654',
      salary: '75000–90000',
    });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/sources/adzuna.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `src/sources/adzuna.ts`**

```ts
import type { Config } from '../config';
import type { JobPosting, WorkMode } from '../types';
import { stripHtml } from '../util';

export interface AdzunaResponse {
  results: {
    id: string;
    title: string;
    company: { display_name: string };
    location: { display_name: string };
    description: string;
    redirect_url: string;
    created: string;
    salary_min?: number;
    salary_max?: number;
  }[];
}

export function inferWorkMode(text: string): WorkMode {
  const t = text.toLowerCase();
  if (/\b(hybrid)\b/.test(t)) return 'hybrid';
  if (/\b(remote|home\s?office)\b/.test(t)) return 'remote';
  if (/\b(on-?site|vor ort)\b/.test(t)) return 'onsite';
  return 'unknown';
}

export function normalizeAdzuna(payload: AdzunaResponse): JobPosting[] {
  return payload.results.map((j) => ({
    id: `adzuna:${j.id}`,
    source: 'adzuna',
    url: j.redirect_url,
    title: j.title,
    company: j.company.display_name,
    location: j.location.display_name,
    workMode: inferWorkMode(`${j.title} ${j.description}`),
    description: stripHtml(j.description),
    postedAt: new Date(j.created).toISOString(),
    ...(j.salary_min && j.salary_max ? { salary: `${j.salary_min}–${j.salary_max}` } : {}),
  }));
}

export async function fetchAdzuna(config: Config): Promise<JobPosting[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) throw new Error('adzuna: ADZUNA_APP_ID / ADZUNA_APP_KEY not set');
  const all: JobPosting[] = [];
  for (const term of config.searchTerms) {
    const url = new URL('https://api.adzuna.com/v1/api/jobs/de/search/1');
    url.searchParams.set('app_id', appId);
    url.searchParams.set('app_key', appKey);
    url.searchParams.set('what', term);
    url.searchParams.set('results_per_page', '50');
    url.searchParams.set('max_days_old', '2');
    url.searchParams.set('content-type', 'application/json');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`adzuna: HTTP ${res.status} for "${term}"`);
    all.push(...normalizeAdzuna((await res.json()) as AdzunaResponse));
  }
  return all;
}
```

- [ ] **Step 5: Write `fixtures/jsearch.json`**

```json
{
  "data": [
    {
      "job_id": "abc123==",
      "employer_name": "Gamma Labs",
      "job_title": "Staff Software Engineer, Frontend",
      "job_description": "Join our Berlin office or work remotely from anywhere in Germany.",
      "job_apply_link": "https://www.stepstone.de/job/12345",
      "job_city": "Berlin",
      "job_country": "DE",
      "job_is_remote": true,
      "job_posted_at_datetime_utc": "2026-06-09T10:00:00.000Z"
    }
  ]
}
```

- [ ] **Step 6: Write the failing test `src/sources/jsearch.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/jsearch.json';
import { normalizeJsearch } from './jsearch';

describe('normalizeJsearch', () => {
  it('maps Google-for-Jobs results to JobPosting', () => {
    const [job] = normalizeJsearch(fixture);
    expect(job).toMatchObject({
      id: 'jsearch:abc123==',
      source: 'jsearch',
      title: 'Staff Software Engineer, Frontend',
      company: 'Gamma Labs',
      location: 'Berlin, DE',
      workMode: 'remote',
      url: 'https://www.stepstone.de/job/12345',
    });
  });
});
```

- [ ] **Step 7: Run to verify failure**

Run: `npx vitest run src/sources/jsearch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Write `src/sources/jsearch.ts`**

```ts
import type { Config } from '../config';
import type { JobPosting } from '../types';
import { stripHtml } from '../util';
import { inferWorkMode } from './adzuna';

export interface JsearchResponse {
  data: {
    job_id: string;
    employer_name: string;
    job_title: string;
    job_description: string;
    job_apply_link: string;
    job_city: string | null;
    job_country: string | null;
    job_is_remote: boolean;
    job_posted_at_datetime_utc: string | null;
  }[];
}

export function normalizeJsearch(payload: JsearchResponse): JobPosting[] {
  return payload.data.map((j) => ({
    id: `jsearch:${j.job_id}`,
    source: 'jsearch',
    url: j.job_apply_link,
    title: j.job_title,
    company: j.employer_name,
    location: [j.job_city, j.job_country].filter(Boolean).join(', '),
    workMode: j.job_is_remote ? ('remote' as const) : inferWorkMode(j.job_description),
    description: stripHtml(j.job_description),
    postedAt: j.job_posted_at_datetime_utc ?? new Date(0).toISOString(),
  }));
}

export async function fetchJsearch(config: Config): Promise<JobPosting[]> {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) throw new Error('jsearch: RAPIDAPI_KEY not set');
  const all: JobPosting[] = [];
  for (const term of config.searchTerms) {
    const url = new URL('https://jsearch.p.rapidapi.com/search');
    url.searchParams.set('query', `${term} in Germany`);
    url.searchParams.set('date_posted', 'today');
    url.searchParams.set('num_pages', '1');
    const res = await fetch(url, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' },
    });
    if (!res.ok) throw new Error(`jsearch: HTTP ${res.status} for "${term}"`);
    all.push(...normalizeJsearch((await res.json()) as JsearchResponse));
  }
  return all;
}
```

- [ ] **Step 9: Run tests + typecheck**

Run: `npx vitest run src/sources && npm run typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: adzuna and jsearch sources (keyed APIs, work-mode inference)"
```

---

### Task 8: Source — HN Who's Hiring

**Files:**
- Create: `src/sources/hn-whoishiring.ts`, `fixtures/hn-comments.json`
- Test: `src/sources/hn-whoishiring.test.ts`

- [ ] **Step 1: Write `fixtures/hn-comments.json`**

(Shape of `https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_<id>`.)

```json
{
  "hits": [
    {
      "objectID": "40000001",
      "comment_text": "Delta Systems | Senior Frontend Engineer | Berlin or Remote (EU) | Full-time<p>We build developer tools with React and TypeScript. Apply at jobs@delta.example</p>",
      "created_at": "2026-06-02T09:00:00.000Z"
    },
    {
      "objectID": "40000002",
      "comment_text": "Tiny reply comment, not a posting",
      "created_at": "2026-06-02T10:00:00.000Z"
    }
  ]
}
```

- [ ] **Step 2: Write the failing test `src/sources/hn-whoishiring.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/hn-comments.json';
import { normalizeHnComments } from './hn-whoishiring';

describe('normalizeHnComments', () => {
  it('parses pipe-separated headline into company/title/location', () => {
    const jobs = normalizeHnComments(fixture);
    expect(jobs).toHaveLength(1); // short reply comment dropped
    expect(jobs[0]).toMatchObject({
      id: 'hn:40000001',
      source: 'hn',
      title: 'Senior Frontend Engineer',
      company: 'Delta Systems',
      location: 'Berlin or Remote (EU)',
      workMode: 'remote',
      url: 'https://news.ycombinator.com/item?id=40000001',
    });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/sources/hn-whoishiring.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `src/sources/hn-whoishiring.ts`**

```ts
import type { JobPosting } from '../types';
import { stripHtml } from '../util';

export interface HnCommentsResponse {
  hits: { objectID: string; comment_text: string | null; created_at: string }[];
}

interface HnStoriesResponse {
  hits: { objectID: string; title: string }[];
}

export function normalizeHnComments(payload: HnCommentsResponse): JobPosting[] {
  const jobs: JobPosting[] = [];
  for (const hit of payload.hits) {
    const text = stripHtml(hit.comment_text ?? '');
    if (text.length < 80) continue; // replies / noise, not postings
    const headline = text.split(/(?<=^[^.]{0,200})\s{2,}|(?=Apply|http)/)[0] ?? text;
    const parts = headline.split('|').map((s) => s.trim());
    if (parts.length < 2) continue; // postings follow "Company | Role | Location | ..."
    const [company, title, location = ''] = parts;
    jobs.push({
      id: `hn:${hit.objectID}`,
      source: 'hn',
      url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      title: title ?? '',
      company: company ?? '',
      location,
      workMode: /remote/i.test(text) ? 'remote' : 'unknown',
      description: text.slice(0, 4000),
      postedAt: new Date(hit.created_at).toISOString(),
    });
  }
  return jobs;
}

export async function fetchHnWhoIsHiring(): Promise<JobPosting[]> {
  const storiesRes = await fetch(
    'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=who%20is%20hiring',
  );
  if (!storiesRes.ok) throw new Error(`hn stories: HTTP ${storiesRes.status}`);
  const stories = (await storiesRes.json()) as HnStoriesResponse;
  const latest = stories.hits.find((h) => /who is hiring/i.test(h.title));
  if (!latest) return [];
  const commentsRes = await fetch(
    `https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_${latest.objectID}&hitsPerPage=300`,
  );
  if (!commentsRes.ok) throw new Error(`hn comments: HTTP ${commentsRes.status}`);
  return normalizeHnComments((await commentsRes.json()) as HnCommentsResponse);
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/sources/hn-whoishiring.test.ts`
Expected: PASS. If the headline-splitting regex misbehaves on the fixture, simplify: take `text.slice(0, 200)`, split on `|`, require ≥ 2 parts — adjust the implementation, not the test's expected values.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: hn who's hiring source via algolia api"
```

---

### Task 9: Source — company watchlist (Greenhouse, Lever, Personio)

**Files:**
- Create: `src/sources/watchlist.ts`, `fixtures/greenhouse.json`, `fixtures/lever.json`, `fixtures/personio.json`
- Test: `src/sources/watchlist.test.ts`

- [ ] **Step 1: Write fixtures**

`fixtures/greenhouse.json` (shape of `https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true`):

```json
{
  "jobs": [
    {
      "id": 555,
      "title": "Senior Product Engineer",
      "absolute_url": "https://boards.greenhouse.io/acme/jobs/555",
      "location": { "name": "Berlin, Germany" },
      "content": "&lt;p&gt;React, TypeScript, Node.&lt;/p&gt;",
      "updated_at": "2026-06-08T00:00:00-00:00"
    }
  ]
}
```

`fixtures/lever.json` (shape of `https://api.lever.co/v0/postings/<slug>?mode=json`):

```json
[
  {
    "id": "lever-uuid-1",
    "text": "Engineering Manager, Web",
    "hostedUrl": "https://jobs.lever.co/acme/lever-uuid-1",
    "categories": { "location": "Remote - Germany", "commitment": "Full-time" },
    "descriptionPlain": "Lead a team of frontend engineers.",
    "createdAt": 1765300000000
  }
]
```

`fixtures/personio.json` (shape of `https://<slug>.jobs.personio.de/search.json` — verify against a real company on first use; per-source isolation contains any drift):

```json
[
  {
    "id": 777,
    "name": "Senior Fullstack Engineer (m/w/d)",
    "office": "Berlin",
    "department": "Engineering",
    "descriptions": [{ "name": "description", "value": "<p>TypeScript across the stack.</p>" }]
  }
]
```

- [ ] **Step 2: Write the failing test `src/sources/watchlist.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import greenhouse from '../../fixtures/greenhouse.json';
import lever from '../../fixtures/lever.json';
import personio from '../../fixtures/personio.json';
import { normalizeGreenhouse, normalizeLever, normalizePersonio } from './watchlist';

describe('watchlist normalizers', () => {
  it('greenhouse', () => {
    const [job] = normalizeGreenhouse('acme', greenhouse);
    expect(job).toMatchObject({
      id: 'greenhouse:acme:555',
      source: 'greenhouse',
      company: 'acme',
      title: 'Senior Product Engineer',
      location: 'Berlin, Germany',
      url: 'https://boards.greenhouse.io/acme/jobs/555',
    });
    expect(job?.description).toBe('React, TypeScript, Node.');
  });

  it('lever', () => {
    const [job] = normalizeLever('acme', lever);
    expect(job).toMatchObject({
      id: 'lever:acme:lever-uuid-1',
      source: 'lever',
      title: 'Engineering Manager, Web',
      location: 'Remote - Germany',
      workMode: 'remote',
    });
  });

  it('personio', () => {
    const [job] = normalizePersonio('acme', personio);
    expect(job).toMatchObject({
      id: 'personio:acme:777',
      source: 'personio',
      title: 'Senior Fullstack Engineer (m/w/d)',
      location: 'Berlin',
    });
    expect(job?.description).toBe('TypeScript across the stack.');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/sources/watchlist.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `src/sources/watchlist.ts`**

```ts
import type { Config } from '../config';
import type { JobPosting } from '../types';
import { stripHtml } from '../util';
import { inferWorkMode } from './adzuna';

export interface GreenhouseResponse {
  jobs: { id: number; title: string; absolute_url: string; location: { name: string }; content: string; updated_at: string }[];
}

export function normalizeGreenhouse(slug: string, payload: GreenhouseResponse): JobPosting[] {
  return payload.jobs.map((j) => {
    const description = stripHtml(
      j.content.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
    );
    return {
      id: `greenhouse:${slug}:${j.id}`,
      source: 'greenhouse',
      url: j.absolute_url,
      title: j.title,
      company: slug,
      location: j.location.name,
      workMode: inferWorkMode(`${j.location.name} ${description}`),
      description,
      postedAt: new Date(j.updated_at).toISOString(),
    };
  });
}

export type LeverResponse = {
  id: string;
  text: string;
  hostedUrl: string;
  categories: { location?: string; commitment?: string };
  descriptionPlain: string;
  createdAt: number;
}[];

export function normalizeLever(slug: string, payload: LeverResponse): JobPosting[] {
  return payload.map((j) => ({
    id: `lever:${slug}:${j.id}`,
    source: 'lever',
    url: j.hostedUrl,
    title: j.text,
    company: slug,
    location: j.categories.location ?? '',
    workMode: inferWorkMode(`${j.categories.location ?? ''} ${j.descriptionPlain}`),
    description: j.descriptionPlain,
    postedAt: new Date(j.createdAt).toISOString(),
  }));
}

export type PersonioResponse = {
  id: number;
  name: string;
  office?: string;
  descriptions?: { name: string; value: string }[];
}[];

export function normalizePersonio(slug: string, payload: PersonioResponse): JobPosting[] {
  return payload.map((j) => {
    const description = stripHtml((j.descriptions ?? []).map((d) => d.value).join(' '));
    return {
      id: `personio:${slug}:${j.id}`,
      source: 'personio',
      url: `https://${slug}.jobs.personio.de/job/${j.id}`,
      title: j.name,
      company: slug,
      location: j.office ?? '',
      workMode: inferWorkMode(`${j.office ?? ''} ${description}`),
      description,
      postedAt: new Date(0).toISOString(), // personio search.json has no posting date
    };
  });
}

export async function fetchWatchlist(config: Config): Promise<JobPosting[]> {
  const all: JobPosting[] = [];
  for (const slug of config.watchlist.greenhouse) {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
    if (!res.ok) throw new Error(`greenhouse ${slug}: HTTP ${res.status}`);
    all.push(...normalizeGreenhouse(slug, (await res.json()) as GreenhouseResponse));
  }
  for (const slug of config.watchlist.lever) {
    const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`);
    if (!res.ok) throw new Error(`lever ${slug}: HTTP ${res.status}`);
    all.push(...normalizeLever(slug, (await res.json()) as LeverResponse));
  }
  for (const slug of config.watchlist.personio) {
    const res = await fetch(`https://${slug}.jobs.personio.de/search.json`);
    if (!res.ok) throw new Error(`personio ${slug}: HTTP ${res.status}`);
    all.push(...normalizePersonio(slug, (await res.json()) as PersonioResponse));
  }
  return all;
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/sources/watchlist.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: company watchlist source (greenhouse, lever, personio)"
```

---

### Task 10: Source registry with per-source isolation

**Files:**
- Create: `src/sources/index.ts`
- Test: `src/sources/index.test.ts`

- [ ] **Step 1: Write the failing test `src/sources/index.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { Config } from '../config';
import type { JobPosting } from '../types';
import { buildSourceTasks, runSources } from './index';

const posting: JobPosting = {
  id: 'ok:1',
  source: 'ok',
  url: 'u',
  title: 't',
  company: 'c',
  location: 'Berlin',
  workMode: 'remote',
  description: 'd',
  postedAt: '2026-06-10T00:00:00.000Z',
};

describe('runSources', () => {
  it('collects postings and isolates failures per source', async () => {
    const result = await runSources([
      { name: 'good', fn: async () => [posting] },
      { name: 'bad', fn: async () => { throw new Error('boom'); } },
    ]);
    expect(result.postings).toEqual([posting]);
    expect(result.failures).toEqual([{ source: 'bad', error: 'boom' }]);
  });
});

describe('buildSourceTasks', () => {
  const config = {
    sources: { arbeitnow: true, remoteok: false, adzuna: true, hnWhoIsHiring: true, jsearch: true, watchlist: true },
    watchlist: { greenhouse: [], lever: [], personio: [] },
    searchTerms: [],
  } as Partial<Config> as Config;

  it('respects source toggles and the jsearch flag', () => {
    const daily = buildSourceTasks(config, { includeJsearch: true }).map((t) => t.name);
    expect(daily).toContain('arbeitnow');
    expect(daily).not.toContain('remoteok');
    expect(daily).toContain('jsearch');

    const intraday = buildSourceTasks(config, { includeJsearch: false }).map((t) => t.name);
    expect(intraday).not.toContain('jsearch');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/sources/index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/sources/index.ts`**

```ts
import type { Config } from '../config';
import type { JobPosting } from '../types';
import { fetchAdzuna } from './adzuna';
import { fetchArbeitnow } from './arbeitnow';
import { fetchHnWhoIsHiring } from './hn-whoishiring';
import { fetchJsearch } from './jsearch';
import { fetchRemoteok } from './remoteok';
import { fetchWatchlist } from './watchlist';

export interface SourceTask {
  name: string;
  fn: () => Promise<JobPosting[]>;
}

export interface SourceRunResult {
  postings: JobPosting[];
  failures: { source: string; error: string }[];
}

export function buildSourceTasks(config: Config, opts: { includeJsearch: boolean }): SourceTask[] {
  const tasks: SourceTask[] = [];
  if (config.sources.arbeitnow) tasks.push({ name: 'arbeitnow', fn: fetchArbeitnow });
  if (config.sources.remoteok) tasks.push({ name: 'remoteok', fn: fetchRemoteok });
  if (config.sources.adzuna) tasks.push({ name: 'adzuna', fn: () => fetchAdzuna(config) });
  if (config.sources.hnWhoIsHiring) tasks.push({ name: 'hn', fn: fetchHnWhoIsHiring });
  if (config.sources.jsearch && opts.includeJsearch) tasks.push({ name: 'jsearch', fn: () => fetchJsearch(config) });
  if (config.sources.watchlist) tasks.push({ name: 'watchlist', fn: () => fetchWatchlist(config) });
  return tasks;
}

export async function runSources(tasks: SourceTask[]): Promise<SourceRunResult> {
  const settled = await Promise.allSettled(tasks.map((t) => t.fn()));
  const postings: JobPosting[] = [];
  const failures: { source: string; error: string }[] = [];
  settled.forEach((res, i) => {
    const name = tasks[i]!.name;
    if (res.status === 'fulfilled') postings.push(...res.value);
    else failures.push({ source: name, error: res.reason instanceof Error ? res.reason.message : String(res.reason) });
  });
  return { postings, failures };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/sources/index.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: source registry with toggles and per-source failure isolation"
```

---

### Task 11: Scoring (OpenAI structured outputs)

**Files:**
- Create: `src/pipeline/score.ts`
- Test: `src/pipeline/score.test.ts`

Note: if installed `openai` lacks `client.chat.completions.parse`, use `client.beta.chat.completions.parse` — same signature. The wrapper takes a minimal structural interface so tests need no SDK mock.

- [ ] **Step 1: Write the failing test `src/pipeline/score.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { JobPosting } from '../types';
import { buildScoringMessages, ScoreSchema, scoreJob, type ScoringClient } from './score';

const posting: JobPosting = {
  id: 'x:1',
  source: 'x',
  url: 'https://example.com',
  title: 'Senior Frontend Engineer',
  company: 'Acme',
  location: 'Berlin',
  workMode: 'hybrid',
  description: 'React + TypeScript product team.',
  postedAt: '2026-06-10T00:00:00.000Z',
};

describe('buildScoringMessages', () => {
  it('puts profile in the stable system prompt and the job in the user turn', () => {
    const messages = buildScoringMessages('PROFILE TEXT', posting);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('PROFILE TEXT');
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toContain('Senior Frontend Engineer');
    expect(messages[1]?.content).toContain('Acme');
  });
});

describe('ScoreSchema', () => {
  it('rejects out-of-range scores', () => {
    expect(
      ScoreSchema.safeParse({ score: 150, stackFit: 0, seniorityFit: 0, locationFit: 0, reasoning: 'r', language: 'en' })
        .success,
    ).toBe(false);
  });
});

describe('scoreJob', () => {
  it('returns the parsed result from the client', async () => {
    const fake: ScoringClient = {
      parse: async () => ({
        choices: [
          {
            message: {
              parsed: { score: 85, stackFit: 90, seniorityFit: 80, locationFit: 90, reasoning: 'Strong fit', language: 'en' },
            },
          },
        ],
      }),
    };
    const result = await scoreJob(fake, 'gpt-test', 'PROFILE', posting);
    expect(result.score).toBe(85);
  });

  it('throws when the client returns nothing parseable', async () => {
    const fake: ScoringClient = { parse: async () => ({ choices: [] }) };
    await expect(scoreJob(fake, 'gpt-test', 'PROFILE', posting)).rejects.toThrow(/no parsed result/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pipeline/score.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/pipeline/score.ts`**

```ts
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import type { JobPosting, ScoreResult } from '../types';

export const ScoreSchema = z.object({
  score: z.number().min(0).max(100),
  stackFit: z.number().min(0).max(100),
  seniorityFit: z.number().min(0).max(100),
  locationFit: z.number().min(0).max(100),
  reasoning: z.string(),
  language: z.enum(['en', 'de', 'other']),
});

export interface ScoringMessage {
  role: 'system' | 'user';
  content: string;
}

// Minimal structural slice of the OpenAI client so tests can stub it.
export interface ScoringClient {
  parse(args: {
    model: string;
    messages: ScoringMessage[];
    response_format: ReturnType<typeof zodResponseFormat>;
  }): Promise<{ choices: { message: { parsed: ScoreResult | null } }[] }>;
}

export function openaiScoringClient(client: OpenAI): ScoringClient {
  return {
    parse: (args) => client.chat.completions.parse(args),
  };
}

export function buildScoringMessages(profile: string, posting: JobPosting): ScoringMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You score job postings for one specific candidate. Return strict JSON per the schema.',
        'In-scope roles: Senior Frontend (React/TS), Senior Full-stack (TS/Node), Staff/Lead/Principal Engineer, Engineering Manager.',
        'Location scope: remote (EU, hireable from Germany), remote/hybrid in Germany, or Berlin onsite/hybrid.',
        'score = overall fit 0-100. 80+ means: apply today. 60-79: worth a look. Below 60: skip.',
        'reasoning = ONE sentence, the single most decisive factor.',
        'language = main language of the posting text.',
        '',
        'Candidate profile:',
        profile,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Title: ${posting.title}`,
        `Company: ${posting.company}`,
        `Location: ${posting.location || 'unspecified'} (${posting.workMode})`,
        posting.salary ? `Salary: ${posting.salary}` : '',
        '',
        posting.description.slice(0, 8000),
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ];
}

export async function scoreJob(
  client: ScoringClient,
  model: string,
  profile: string,
  posting: JobPosting,
): Promise<ScoreResult> {
  const completion = await client.parse({
    model,
    messages: buildScoringMessages(profile, posting),
    response_format: zodResponseFormat(ScoreSchema, 'job_score'),
  });
  const parsed = completion.choices[0]?.message.parsed;
  if (!parsed) throw new Error(`scoring returned no parsed result for ${posting.id}`);
  return parsed;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/pipeline/score.test.ts && npm run typecheck`
Expected: PASS. If `client.chat.completions.parse(args)` doesn't typecheck against the installed SDK version, adapt only inside `openaiScoringClient` (e.g. `client.beta.chat.completions.parse`) — the `ScoringClient` interface and tests stay unchanged.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: structured job scoring with injectable openai client"
```

---

### Task 12: Tailoring (cover letter + fit summary)

**Files:**
- Create: `src/pipeline/tailor.ts`
- Test: `src/pipeline/tailor.test.ts`

- [ ] **Step 1: Write the failing test `src/pipeline/tailor.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { JobPosting, ScoreResult } from '../types';
import { buildMatchMarkdown, buildTailoringMessages, matchFilename, tailorJob, type TailoringClient } from './tailor';

const posting: JobPosting = {
  id: 'x:1',
  source: 'x',
  url: 'https://example.com/job',
  title: 'Senior Frontend Engineer',
  company: 'Acme GmbH',
  location: 'Berlin',
  workMode: 'hybrid',
  description: 'React + TypeScript.',
  postedAt: '2026-06-10T00:00:00.000Z',
};

const score: ScoreResult = { score: 85, stackFit: 90, seniorityFit: 80, locationFit: 90, reasoning: 'Strong fit', language: 'en' };

describe('matchFilename', () => {
  it('builds a dated slug path', () => {
    expect(matchFilename(posting, '2026-06-10')).toBe('matches/2026-06-10-acme-gmbh-senior-frontend-engineer.md');
  });
});

describe('buildTailoringMessages', () => {
  it('includes profile, posting, and asks for English output', () => {
    const messages = buildTailoringMessages('PROFILE', posting, score);
    expect(messages[0]?.content).toContain('PROFILE');
    expect(messages[0]?.content).toContain('English');
    expect(messages[1]?.content).toContain('Acme GmbH');
  });
});

describe('buildMatchMarkdown', () => {
  it('wraps LLM output with metadata header', () => {
    const md = buildMatchMarkdown(posting, score, 'LLM BODY');
    expect(md).toContain('# Senior Frontend Engineer @ Acme GmbH');
    expect(md).toContain('Score: 85/100');
    expect(md).toContain('https://example.com/job');
    expect(md).toContain('LLM BODY');
  });
});

describe('tailorJob', () => {
  it('returns markdown produced by the client', async () => {
    const fake: TailoringClient = { complete: async () => 'COVER LETTER TEXT' };
    const md = await tailorJob(fake, 'gpt-test', 'PROFILE', posting, score);
    expect(md).toContain('COVER LETTER TEXT');
    expect(md).toContain('Score: 85/100');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pipeline/tailor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/pipeline/tailor.ts`**

```ts
import OpenAI from 'openai';
import type { JobPosting, ScoreResult } from '../types';
import { slugify } from '../util';

export interface TailoringMessage {
  role: 'system' | 'user';
  content: string;
}

export interface TailoringClient {
  complete(args: { model: string; messages: TailoringMessage[] }): Promise<string>;
}

export function openaiTailoringClient(client: OpenAI): TailoringClient {
  return {
    complete: async (args) => {
      const res = await client.chat.completions.create({ model: args.model, messages: args.messages });
      return res.choices[0]?.message.content ?? '';
    },
  };
}

export function matchFilename(posting: JobPosting, date: string): string {
  return `matches/${date}-${slugify(posting.company)}-${slugify(posting.title)}.md`;
}

export function buildTailoringMessages(profile: string, posting: JobPosting, score: ScoreResult): TailoringMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You write application material for one specific candidate. Output language: English, always.',
        'Produce three markdown sections:',
        '## Fit summary — 3-5 bullets: why the candidate fits, plus any gaps to address.',
        '## Talking points — 3-5 bullets: specifics to mention in an intro call, plus 2 questions to ask them.',
        '## Cover letter — ~250 words, concrete, no fluff, references real items from the profile and the posting.',
        '',
        'Candidate profile:',
        profile,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Title: ${posting.title}`,
        `Company: ${posting.company}`,
        `Location: ${posting.location} (${posting.workMode})`,
        `Pre-screen score: ${score.score}/100 — ${score.reasoning}`,
        '',
        posting.description.slice(0, 10000),
      ].join('\n'),
    },
  ];
}

export function buildMatchMarkdown(posting: JobPosting, score: ScoreResult, llmBody: string): string {
  return [
    `# ${posting.title} @ ${posting.company}`,
    '',
    `- Score: ${score.score}/100 (stack ${score.stackFit}, seniority ${score.seniorityFit}, location ${score.locationFit})`,
    `- Reasoning: ${score.reasoning}`,
    `- Location: ${posting.location} (${posting.workMode})`,
    `- Posting: ${posting.url}`,
    `- Source: ${posting.source}, posted ${posting.postedAt}`,
    score.language === 'de' ? '- ⚠️ German-language posting' : '',
    '',
    llmBody,
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export async function tailorJob(
  client: TailoringClient,
  model: string,
  profile: string,
  posting: JobPosting,
  score: ScoreResult,
): Promise<string> {
  const body = await client.complete({ model, messages: buildTailoringMessages(profile, posting, score) });
  return buildMatchMarkdown(posting, score, body);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/pipeline/tailor.test.ts && npm run typecheck`
Expected: PASS. Note: `buildMatchMarkdown` filters empty strings, which also removes intentional blank lines — if output renders cramped, replace the `filter` with a conditional spread for the German-flag line only; keep tests green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: tailoring stage producing match markdown via strong model"
```

---

### Task 13: Selection + Telegram notifier

**Files:**
- Create: `src/pipeline/select.ts`, `src/pipeline/notify.ts`
- Test: `src/pipeline/select.test.ts`, `src/pipeline/notify.test.ts`

- [ ] **Step 1: Write the failing test `src/pipeline/select.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { JobPosting, JobRecord, State } from '../types';
import { selectAlertJobs, selectDigestJobs } from './select';

function record(id: string, score: number, status: JobRecord['status'], firstSeenAt: string): JobRecord {
  const posting: JobPosting = {
    id, source: 's', url: 'u', title: 't', company: 'c', location: 'Berlin',
    workMode: 'remote', description: 'd', postedAt: firstSeenAt,
  };
  return {
    posting,
    fuzzyKey: id,
    status,
    score: { score, stackFit: score, seniorityFit: score, locationFit: score, reasoning: 'r', language: 'en' },
    firstSeenAt,
    updatedAt: firstSeenAt,
  };
}

function state(records: JobRecord[]): State {
  return { jobs: Object.fromEntries(records.map((r) => [r.posting.id, r])), sourceFailures: {} };
}

describe('selectAlertJobs', () => {
  it('picks scored jobs at or above hot threshold only', () => {
    const s = state([
      record('a', 85, 'scored', '2026-06-10T08:00:00Z'),
      record('b', 70, 'scored', '2026-06-10T08:00:00Z'),
      record('c', 90, 'alerted', '2026-06-10T08:00:00Z'), // already alerted
    ]);
    expect(selectAlertJobs(s, 80).map((r) => r.posting.id)).toEqual(['a']);
  });
});

describe('selectDigestJobs', () => {
  it('picks recent scored+alerted jobs above digest threshold, sorted by score desc', () => {
    const s = state([
      record('a', 65, 'scored', '2026-06-10T08:00:00Z'),
      record('b', 90, 'alerted', '2026-06-10T09:00:00Z'),
      record('c', 50, 'scored', '2026-06-10T08:00:00Z'), // below threshold
      record('d', 95, 'scored', '2026-06-01T08:00:00Z'), // too old
      record('e', 88, 'digested', '2026-06-10T08:00:00Z'), // already digested
    ]);
    const picked = selectDigestJobs(s, 60, '2026-06-09T12:00:00Z');
    expect(picked.map((r) => r.posting.id)).toEqual(['b', 'a']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/pipeline/select.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/pipeline/select.ts`**

```ts
import type { JobRecord, State } from '../types';

export function selectAlertJobs(state: State, hotThreshold: number): JobRecord[] {
  return Object.values(state.jobs)
    .filter((r) => r.status === 'scored' && (r.score?.score ?? 0) >= hotThreshold)
    .sort((a, b) => (b.score?.score ?? 0) - (a.score?.score ?? 0));
}

export function selectDigestJobs(state: State, digestThreshold: number, sinceIso: string): JobRecord[] {
  return Object.values(state.jobs)
    .filter(
      (r) =>
        (r.status === 'scored' || r.status === 'alerted') &&
        (r.score?.score ?? 0) >= digestThreshold &&
        r.firstSeenAt >= sinceIso,
    )
    .sort((a, b) => (b.score?.score ?? 0) - (a.score?.score ?? 0));
}
```

- [ ] **Step 4: Write the failing test `src/pipeline/notify.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { JobPosting, JobRecord } from '../types';
import { formatAlertMessage, formatDigestMessage } from './notify';

const posting: JobPosting = {
  id: 'x:1', source: 'x', url: 'https://example.com/job', title: 'Senior Frontend Engineer',
  company: 'Acme', location: 'Berlin', workMode: 'hybrid', description: 'd', postedAt: '2026-06-10T00:00:00Z',
};

const record: JobRecord = {
  posting,
  fuzzyKey: 'k',
  status: 'scored',
  score: { score: 85, stackFit: 90, seniorityFit: 80, locationFit: 90, reasoning: 'Strong React/TS match', language: 'en' },
  matchFile: 'matches/2026-06-10-acme-senior-frontend-engineer.md',
  languageFlag: 'de',
  firstSeenAt: '2026-06-10T08:00:00Z',
  updatedAt: '2026-06-10T08:00:00Z',
};

describe('formatAlertMessage', () => {
  it('includes score, role, reasoning, url, match file and language flag', () => {
    const msg = formatAlertMessage(record);
    expect(msg).toContain('85/100');
    expect(msg).toContain('Senior Frontend Engineer @ Acme');
    expect(msg).toContain('Strong React/TS match');
    expect(msg).toContain('https://example.com/job');
    expect(msg).toContain('matches/2026-06-10-acme-senior-frontend-engineer.md');
    expect(msg).toContain('German');
  });
});

describe('formatDigestMessage', () => {
  it('ranks jobs and appends source warnings', () => {
    const msg = formatDigestMessage([record], ['adzuna']);
    expect(msg).toContain('1.');
    expect(msg).toContain('85');
    expect(msg).toContain('⚠️ Source failing: adzuna');
  });

  it('says so when there are no matches', () => {
    expect(formatDigestMessage([], [])).toContain('No new matches');
  });
});
```

- [ ] **Step 5: Run to verify failure**

Run: `npx vitest run src/pipeline/notify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 6: Write `src/pipeline/notify.ts`**

```ts
import type { JobRecord } from '../types';

export function formatAlertMessage(record: JobRecord): string {
  const score = record.score;
  const posting = record.posting;
  return [
    `🔥 ${score?.score}/100 — ${posting.title} @ ${posting.company}`,
    `${posting.location || 'location unknown'} (${posting.workMode})${record.languageFlag === 'de' ? ' — ⚠️ German posting' : ''}`,
    score?.reasoning ?? '',
    posting.url,
    record.matchFile ? `Tailored material: ${record.matchFile}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatDigestMessage(records: JobRecord[], failingSources: string[]): string {
  const lines: string[] = [`📋 Job digest — ${records.length} new match${records.length === 1 ? '' : 'es'}`];
  if (records.length === 0) {
    lines.push('No new matches in the last 24h.');
  } else {
    records.forEach((r, i) => {
      const de = r.languageFlag === 'de' ? ' ⚠️DE' : '';
      lines.push(`${i + 1}. ${r.score?.score}/100 — ${r.posting.title} @ ${r.posting.company}${de}`);
      lines.push(`   ${r.posting.url}`);
      if (r.matchFile) lines.push(`   📄 ${r.matchFile}`);
    });
  }
  for (const source of failingSources) lines.push(`⚠️ Source failing: ${source}`);
  return lines.join('\n');
}

export async function sendTelegram(token: string, chatId: string, text: string): Promise<void> {
  // Telegram caps messages at 4096 chars — split on line boundaries.
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > 4000) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);

  for (const chunk of chunks) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunk, disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`telegram: HTTP ${res.status} ${await res.text()}`);
  }
}
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run src/pipeline && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: alert/digest selection and telegram notifier with chunking"
```

---

### Task 14: Orchestrator (`run.ts` with modes and dry-run)

**Files:**
- Create: `src/run.ts`, `src/dry-run.ts`
- Test: `src/dry-run.test.ts`

- [ ] **Step 1: Write the failing test `src/dry-run.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { fakeScore, loadFixturePostings } from './dry-run';

describe('loadFixturePostings', () => {
  it('loads and normalizes all source fixtures', () => {
    const postings = loadFixturePostings();
    const sources = new Set(postings.map((p) => p.source));
    expect(sources).toEqual(new Set(['arbeitnow', 'remoteok', 'adzuna', 'jsearch', 'hn', 'greenhouse', 'lever', 'personio']));
    expect(postings.length).toBeGreaterThanOrEqual(8);
  });
});

describe('fakeScore', () => {
  it('is deterministic per posting id', () => {
    const postings = loadFixturePostings();
    const a = fakeScore(postings[0]!);
    const b = fakeScore(postings[0]!);
    expect(a).toEqual(b);
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/dry-run.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/dry-run.ts`**

```ts
import { readFileSync } from 'node:fs';
import type { JobPosting, ScoreResult } from './types';
import { normalizeAdzuna, type AdzunaResponse } from './sources/adzuna';
import { normalizeArbeitnow, type ArbeitnowResponse } from './sources/arbeitnow';
import { normalizeHnComments, type HnCommentsResponse } from './sources/hn-whoishiring';
import { normalizeJsearch, type JsearchResponse } from './sources/jsearch';
import { normalizeRemoteok } from './sources/remoteok';
import {
  normalizeGreenhouse, normalizeLever, normalizePersonio,
  type GreenhouseResponse, type LeverResponse, type PersonioResponse,
} from './sources/watchlist';

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(`fixtures/${name}.json`, 'utf8')) as T;
}

export function loadFixturePostings(): JobPosting[] {
  return [
    ...normalizeArbeitnow(fixture<ArbeitnowResponse>('arbeitnow')),
    ...normalizeRemoteok(fixture<unknown[]>('remoteok')),
    ...normalizeAdzuna(fixture<AdzunaResponse>('adzuna')),
    ...normalizeJsearch(fixture<JsearchResponse>('jsearch')),
    ...normalizeHnComments(fixture<HnCommentsResponse>('hn-comments')),
    ...normalizeGreenhouse('acme', fixture<GreenhouseResponse>('greenhouse')),
    ...normalizeLever('acme', fixture<LeverResponse>('lever')),
    ...normalizePersonio('acme', fixture<PersonioResponse>('personio')),
  ];
}

export function fakeScore(posting: JobPosting): ScoreResult {
  // Deterministic pseudo-score from the id so dry-run output is stable.
  let hash = 0;
  for (const ch of posting.id) hash = (hash * 31 + ch.charCodeAt(0)) % 101;
  return {
    score: hash,
    stackFit: hash,
    seniorityFit: hash,
    locationFit: hash,
    reasoning: `dry-run fake score for ${posting.id}`,
    language: 'en',
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/dry-run.test.ts`
Expected: PASS. (Test runs from repo root, so the relative `fixtures/` path resolves.)

- [ ] **Step 5: Write `src/run.ts`** (thin wiring — verified by the dry-run step below, not unit-tested)

```ts
import { writeFileSync } from 'node:fs';
import OpenAI from 'openai';
import { loadConfig } from './config';
import { fakeScore, loadFixturePostings } from './dry-run';
import { dedupe, fuzzyKey } from './pipeline/dedupe';
import { hardFilter } from './pipeline/filter';
import { formatAlertMessage, formatDigestMessage, sendTelegram } from './pipeline/notify';
import { openaiScoringClient, scoreJob } from './pipeline/score';
import { selectAlertJobs, selectDigestJobs } from './pipeline/select';
import {
  addJob, clearSourceFailure, loadState, recordSourceFailure, saveState, setStatus,
} from './pipeline/state';
import { matchFilename, openaiTailoringClient, tailorJob } from './pipeline/tailor';
import { buildSourceTasks, runSources } from './sources/index';

const STATE_PATH = 'state/jobs.json';
const PROFILE_PATH = 'profile.md';

async function main(): Promise<void> {
  const mode = process.argv.includes('--mode=digest') ? 'digest' : 'alerts';
  const dryRun = process.argv.includes('--dry-run');
  const config = loadConfig();
  const state = loadState(STATE_PATH);
  const profile = dryRun ? 'dry-run profile' : (await import('node:fs')).readFileSync(PROFILE_PATH, 'utf8');

  // 1. Fetch
  let postings;
  let failures: { source: string; error: string }[] = [];
  if (dryRun) {
    postings = loadFixturePostings();
  } else {
    const result = await runSources(buildSourceTasks(config, { includeJsearch: mode === 'digest' }));
    postings = result.postings;
    failures = result.failures;
    for (const f of failures) recordSourceFailure(state, f.source, f.error);
    const failedNames = new Set(failures.map((f) => f.source));
    for (const t of buildSourceTasks(config, { includeJsearch: mode === 'digest' })) {
      if (!failedNames.has(t.name)) clearSourceFailure(state, t.name);
    }
  }
  console.log(`fetched ${postings.length} postings (${failures.length} source failures)`);

  // 2. Dedupe + 3. Hard filter
  const fresh = dedupe(postings, state);
  const { kept, flaggedDe } = hardFilter(fresh, config);
  console.log(`new: ${fresh.length}, after hard filter: ${kept.length}`);

  // 4. Score (capped)
  const openai = dryRun ? null : new OpenAI();
  const scoringClient = openai ? openaiScoringClient(openai) : null;
  const toScore = kept.slice(0, config.maxJobsScoredPerRun);
  if (kept.length > toScore.length) console.log(`cost cap: scoring ${toScore.length}/${kept.length}`);
  for (const posting of toScore) {
    const record = addJob(state, posting, fuzzyKey(posting), flaggedDe.has(posting.id) ? 'de' : undefined);
    try {
      record.score = scoringClient
        ? await scoreJob(scoringClient, config.models.scoring, profile, posting)
        : fakeScore(posting);
      setStatus(record, 'scored');
    } catch (err) {
      console.error(`scoring failed for ${posting.id}, will retry next run:`, err);
      // stays 'seen' — but remove so a later run re-discovers it via fuzzy key? No:
      // keep the record; next run re-scores everything still in 'seen'.
    }
  }
  // Retry previously failed scorings
  for (const record of Object.values(state.jobs).filter((r) => r.status === 'seen' && !r.score)) {
    try {
      record.score = scoringClient
        ? await scoreJob(scoringClient, config.models.scoring, profile, record.posting)
        : fakeScore(record.posting);
      setStatus(record, 'scored');
    } catch (err) {
      console.error(`re-scoring failed for ${record.posting.id}:`, err);
    }
  }

  // 5. Tailor everything digest-worthy that has no match file yet
  const tailoringClient = openai ? openaiTailoringClient(openai) : null;
  const date = new Date().toISOString().slice(0, 10);
  for (const record of Object.values(state.jobs)) {
    const score = record.score;
    if (!score || score.score < config.thresholds.digest || record.matchFile) continue;
    if (record.status !== 'scored') continue;
    const file = matchFilename(record.posting, date);
    const markdown = tailoringClient
      ? await tailorJob(tailoringClient, config.models.tailoring, profile, record.posting, score)
      : `# dry-run match for ${record.posting.id}\n`;
    if (!dryRun) writeFileSync(file, markdown);
    record.matchFile = file;
    console.log(`tailored: ${file}`);
  }

  // 6. Notify
  const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  const chatId = process.env.TELEGRAM_CHAT_ID ?? '';
  if (mode === 'alerts') {
    for (const record of selectAlertJobs(state, config.thresholds.hot)) {
      const message = formatAlertMessage(record);
      if (dryRun) console.log('[dry-run alert]\n' + message);
      else await sendTelegram(token, chatId, message);
      setStatus(record, 'alerted');
    }
  } else {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const digestJobs = selectDigestJobs(state, config.thresholds.digest, since);
    const failing = Object.entries(state.sourceFailures)
      .filter(([, f]) => f.consecutiveFailures >= 3)
      .map(([name]) => name);
    const message = formatDigestMessage(digestJobs, failing);
    if (dryRun) console.log('[dry-run digest]\n' + message);
    else await sendTelegram(token, chatId, message);
    for (const record of digestJobs) setStatus(record, 'digested');
    // Archive scored-but-below-threshold jobs older than 24h
    for (const record of Object.values(state.jobs)) {
      if (record.status === 'scored' && (record.score?.score ?? 0) < config.thresholds.digest && record.firstSeenAt < since) {
        setStatus(record, 'archived');
      }
    }
  }

  // 7. Persist
  if (!dryRun) saveState(STATE_PATH, state);
  console.log('done');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
```

- [ ] **Step 6: Verify with dry-run**

Run: `npm run dry-run`
Expected: prints fetched/new/filter counts, `[dry-run digest]` block with a ranked list (fixture jobs whose fake score ≥ 60), exits 0. Then run `npm run typecheck && npm test` — all green.

- [ ] **Step 7: Verify alerts mode dry-run**

Run: `tsx src/run.ts --mode=alerts --dry-run`
Expected: `[dry-run alert]` blocks only for fixture jobs with fake score ≥ 80 (possibly none — that's fine; the run must exit 0 either way).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: pipeline orchestrator with alerts/digest modes and dry-run"
```

---

### Task 15: GitHub Actions workflows, profile template, README

**Files:**
- Create: `.github/workflows/alerts.yml`, `.github/workflows/digest.yml`, `profile.md`, `state/jobs.json`, `matches/.gitkeep`, `README.md`

- [ ] **Step 1: Write `.github/workflows/alerts.yml`**

```yaml
name: alerts
on:
  schedule:
    # 10:00-18:00 Berlin (summer, CEST=UTC+2) every 2h, weekdays.
    # Winter (CET=UTC+1) this drifts to 09:00-17:00 — accepted.
    - cron: '0 8-16/2 * * 1-5'
  workflow_dispatch:

concurrency:
  group: job-scout
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  alerts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run alerts
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          ADZUNA_APP_ID: ${{ secrets.ADZUNA_APP_ID }}
          ADZUNA_APP_KEY: ${{ secrets.ADZUNA_APP_KEY }}
          RAPIDAPI_KEY: ${{ secrets.RAPIDAPI_KEY }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
      - name: Commit state
        run: |
          git config user.name "job-scout-bot"
          git config user.email "job-scout-bot@users.noreply.github.com"
          git add state matches
          git diff --cached --quiet || git commit -m "chore: state update (alerts) [skip ci]"
          git push
```

- [ ] **Step 2: Write `.github/workflows/digest.yml`**

```yaml
name: digest
on:
  schedule:
    # 08:30 Berlin (summer). Winter: 07:30 — accepted.
    - cron: '30 6 * * *'
  workflow_dispatch:

concurrency:
  group: job-scout
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  digest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run digest
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          ADZUNA_APP_ID: ${{ secrets.ADZUNA_APP_ID }}
          ADZUNA_APP_KEY: ${{ secrets.ADZUNA_APP_KEY }}
          RAPIDAPI_KEY: ${{ secrets.RAPIDAPI_KEY }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
      - name: Commit state
        run: |
          git config user.name "job-scout-bot"
          git config user.email "job-scout-bot@users.noreply.github.com"
          git add state matches
          git diff --cached --quiet || git commit -m "chore: state update (digest) [skip ci]"
          git push
```

- [ ] **Step 3: Write `profile.md` placeholder for Oleksandr to fill in**

```markdown
# Candidate profile

<!-- Replace with real CV content before the first non-dry run. -->
<!-- The scoring + tailoring prompts read this whole file. Structure: -->

## Summary
Senior frontend/full-stack engineer (React, TypeScript, Node), based in Berlin, Germany.
Open to: senior/staff/lead/principal IC roles and engineering-manager roles.
Languages: English (fluent). Applications in English only.

## Experience
- (Company, role, years, what you built, impact)

## Stack
- Expert: React, TypeScript, ...
- Comfortable: Node, ...

## Preferences
- Remote (EU) or remote/hybrid in Germany or Berlin onsite/hybrid.
- (Salary expectations, company size/stage, industries to avoid, etc.)
```

- [ ] **Step 4: Initialize `state/jobs.json` and `matches/.gitkeep`**

`state/jobs.json`:

```json
{
  "jobs": {},
  "sourceFailures": {}
}
```

```bash
mkdir -p matches && touch matches/.gitkeep
```

- [ ] **Step 5: Write `README.md`**

```markdown
# job-scout

Personal AI job-search pipeline: discovers software jobs (EU/Germany), scores them
against `profile.md` with a cheap OpenAI model, writes tailored application material
with a stronger model, and sends Telegram alerts + a daily digest.
Runs on GitHub Actions cron. Design doc lives outside this repo.

## Setup

1. Fill in `profile.md` with real CV content.
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

## Schedules (UTC cron; Berlin drifts 1h across DST)

- alerts: every 2h, 10:00–18:00 Berlin, Mon–Fri — hot matches (score ≥ 80)
- digest: 08:30 Berlin daily — all new matches ≥ 60, ranked
```

- [ ] **Step 6: Verify everything once more**

Run: `npm test && npm run typecheck && npm run dry-run`
Expected: all tests pass, typecheck clean, dry-run prints a digest and exits 0.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: github actions schedules, profile template, readme"
```

- [ ] **Step 8: Manual follow-ups for Oleksandr (not agent work)**

1. Create the private GitHub repo and push.
2. Add the six Actions secrets (step 5 of README).
3. Fill in `profile.md`, set real watchlist slugs, verify OpenAI model ids in `config.json`.
4. Trigger `digest` workflow manually (workflow_dispatch) and check the Telegram message.
5. Refresh `fixtures/*.json` with real API captures when convenient (shapes were written from API docs; per-source isolation + fixtures make corrections cheap).

---

## Self-review notes (done at plan-writing time)

- **Spec coverage:** all spec sections map to tasks — sources (6–10), dedupe (4), hard filter (5), scoring (11), tailoring (12), notify/selection (13), orchestrator + dry-run (14), workflows/cost-cap/state-commit (14–15). Per-source isolation: Task 10. Cost guard: `maxJobsScoredPerRun` in Tasks 2/14. German flagging: Tasks 5, 12, 13.
- **Known intentional deviations:** Personio fixture shape needs verification against a real company (flagged in Task 9 and README follow-ups). OpenAI model ids are config-only defaults to verify before first run (spec says exactly this).
- **Type consistency check:** `JobPosting`/`JobRecord`/`State`/`ScoreResult` defined once in Task 2 and imported everywhere; `fuzzyKey` (Task 4) used by orchestrator; `matchFilename`/`tailorJob` (Task 12) and `selectAlertJobs`/`selectDigestJobs` (Task 13) match their call sites in Task 14.
