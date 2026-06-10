# Profile as PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read the candidate profile from `profile.pdf` (digitally exported CV) instead of `profile.md`, failing fast with clear errors when the file is missing or has no text layer.

**Architecture:** One new module `src/profile.ts` (`loadProfile`: read → extract text via unpdf → normalize → validate), wired into `src/run.ts` at the existing fail-fast position. Fixtures are tiny hand-generated PDFs committed to `fixtures/`, produced by a checked-in script so they are reproducible.

**Tech Stack:** unpdf (ESM wrapper around Mozilla pdf.js, zero native deps), existing vitest/TypeScript toolchain.

**Spec:** `docs/2026-06-10-profile-pdf-design.md`

**Conventions:** Same as the main plan — colocated tests, `npx vitest run <file>`, `npm test` for all. Commit steps are SUGGEST-ONLY: Oleksandr's standing rule is that the agent never runs `git commit`; leave changes in the working tree and suggest the message.

---

### Task 1: Dependency, fixture generator, fixtures

**Files:**
- Create: `scripts/make-profile-fixtures.mjs`, `fixtures/profile.pdf`, `fixtures/profile-scanned.pdf`
- Modify: `package.json` (unpdf dependency via npm install)

- [ ] **Step 1: Install unpdf**

```bash
npm install unpdf
```

- [ ] **Step 2: Write `scripts/make-profile-fixtures.mjs`**

A minimal-PDF generator with computed xref offsets (ASCII-only text, no parentheses in lines — they would need escaping). Checked in so fixtures are reproducible.

```js
// Generates the test-fixture PDFs in fixtures/. Run: node scripts/make-profile-fixtures.mjs
import { writeFileSync } from 'node:fs';

function buildPdf(lines) {
  const content = lines.length
    ? `BT /F1 12 Tf 72 720 Td\n${lines.map((l) => `(${l}) Tj 0 -16 Td`).join('\n')}\nET`
    : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const [i, body] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

writeFileSync(
  'fixtures/profile.pdf',
  buildPdf([
    'PROFILE FIXTURE Senior Frontend Engineer',
    'Stack: React, TypeScript, Node. Based in Berlin, Germany.',
    'Open to senior, staff, lead and engineering manager roles.',
    'Experience: 10 years building web products end to end.',
    'Languages: English fluent. Applications in English only.',
    'Preferences: remote EU or hybrid in Germany or Berlin onsite.',
  ]),
);
writeFileSync('fixtures/profile-scanned.pdf', buildPdf([]));
console.log('wrote fixtures/profile.pdf and fixtures/profile-scanned.pdf');
```

- [ ] **Step 3: Generate the fixtures**

Run: `node scripts/make-profile-fixtures.mjs`
Expected: prints the wrote-message; `fixtures/profile.pdf` (~1.3 KB) and `fixtures/profile-scanned.pdf` (~1 KB) exist.

- [ ] **Step 4: Sanity-check extraction works on the fixture**

Run:

```bash
node -e "import('unpdf').then(async ({ extractText, getDocumentProxy }) => { const { readFile } = await import('node:fs/promises'); const pdf = await getDocumentProxy(new Uint8Array(await readFile('fixtures/profile.pdf'))); const { text } = await extractText(pdf, { mergePages: true }); console.log(text.slice(0, 80)); })"
```

Expected: prints text starting with `PROFILE FIXTURE Senior Frontend Engineer`. If pdf.js rejects the hand-built PDF, fix the generator (not the later tests) until extraction returns the fixture lines.

- [ ] **Step 5: Commit (suggest-only)**

Suggested message: `feat: unpdf dependency and reproducible profile PDF fixtures`

---

### Task 2: `src/profile.ts` (loadProfile)

**Files:**
- Create: `src/profile.ts`
- Test: `src/profile.test.ts`

- [ ] **Step 1: Write the failing test `src/profile.test.ts`**

```ts
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProfile } from './profile';

describe('loadProfile', () => {
  it('extracts and normalizes text from a PDF', async () => {
    const profile = await loadProfile('fixtures/profile.pdf');
    expect(profile).toContain('PROFILE FIXTURE Senior Frontend Engineer');
    expect(profile).toContain('React, TypeScript, Node');
    expect(profile.length).toBeGreaterThanOrEqual(200);
    expect(profile).not.toMatch(/[^\S\n]{2,}/); // no runs of horizontal whitespace
  });

  it('rejects when the file does not exist', async () => {
    await expect(loadProfile(join(tmpdir(), 'does-not-exist.pdf'))).rejects.toThrow(/not found/);
  });

  it('rejects a PDF without a text layer', async () => {
    await expect(loadProfile('fixtures/profile-scanned.pdf')).rejects.toThrow(/no text layer/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/profile.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/profile.ts`**

```ts
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extractText, getDocumentProxy } from 'unpdf';

const MIN_PROFILE_CHARS = 200;

export async function loadProfile(path = 'profile.pdf'): Promise<string> {
  if (!existsSync(path)) {
    throw new Error(`profile: ${path} not found — export your CV as profile.pdf`);
  }
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)));
  const { text } = await extractText(pdf, { mergePages: true });
  // Collapse horizontal whitespace runs but keep line structure for prompt readability.
  const profile = text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (profile.length < MIN_PROFILE_CHARS) {
    throw new Error(`profile: no text layer found in ${path} (scanned PDF?)`);
  }
  return profile;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/profile.test.ts && npm run typecheck`
Expected: PASS (3 tests), typecheck clean.

- [ ] **Step 5: Commit (suggest-only)**

Suggested message: `feat: loadProfile reads candidate profile from PDF with fail-fast validation`

---

### Task 3: Wire into run.ts, delete profile.md, update README

**Files:**
- Modify: `src/run.ts` (PROFILE_PATH + profile load + possibly the node:fs import), `README.md`
- Delete: `profile.md`

- [ ] **Step 1: Edit `src/run.ts`**

1. Add import: `import { loadProfile } from './profile';`
2. Change `const PROFILE_PATH = 'profile.md';` to `const PROFILE_PATH = 'profile.pdf';`
3. Replace the profile assignment (currently `const profile = dryRun ? 'dry-run profile' : readFileSync(PROFILE_PATH, 'utf8');`) with:

```ts
  const profile = dryRun ? 'dry-run profile' : await loadProfile(PROFILE_PATH);
```

4. If `readFileSync` is now unused in run.ts, remove it from the `node:fs` import list (keep `writeFileSync`/`mkdirSync` which the tailor stage uses). Typecheck will confirm.

Note: the assignment sits before the fetch/score stages, so a missing or scanned `profile.pdf` aborts the run before any network/LLM spend — same fail-fast tier as the Telegram secrets check.

- [ ] **Step 2: Delete `profile.md`**

```bash
rm profile.md
```

- [ ] **Step 3: Update `README.md`**

1. Intro paragraph: change ``scores them against `profile.md` `` to ``scores them against `profile.pdf` ``.
2. Setup step 1: change `Fill in profile.md with real CV content.` to:

```markdown
1. Export your CV as `profile.pdf` at the repo root (a text-based export from
   Word/Google Docs/LaTeX — not a scan; the pipeline fails fast if the PDF has
   no text layer). Commit it: GitHub Actions reads it from the repo.
```

- [ ] **Step 4: Verify everything**

Run: `npm test && npm run typecheck && npm run dry-run && npx tsx src/run.ts --mode=alerts --dry-run`
Expected: all tests pass (3 new profile tests included), typecheck clean, both dry-runs unchanged (dry-run never reads the PDF), exit 0.

- [ ] **Step 5: Verify the fail-fast path**

Run: `TELEGRAM_BOT_TOKEN=x TELEGRAM_CHAT_ID=x npx tsx src/run.ts --mode=alerts; echo "exit: $?"`
Expected: error output containing `profile: profile.pdf not found — export your CV as profile.pdf`, exit 1, and NO `fetched N postings` line (aborts before any fetching). `git status` shows state/jobs.json may be rewritten with identical empty content — acceptable (finally-save of untouched state).

- [ ] **Step 6: Commit (suggest-only)**

Suggested message: `feat: read candidate profile from profile.pdf instead of profile.md`

---

## Self-review notes (done at plan-writing time)

- **Spec coverage:** §2 source/library/committed → Tasks 1+3; §3 `src/profile.ts` contract incl. both error messages → Task 2; §3 run.ts wiring + dry-run stub untouched → Task 3; §3 removals/README → Task 3; §5 fixture + three tests → Tasks 1-2; §4 error handling verified by Task 3 Step 5.
- **No placeholders:** every code step contains complete code; generator script is fully specified.
- **Type consistency:** `loadProfile(path?: string): Promise<string>` defined in Task 2 matches the `await loadProfile(PROFILE_PATH)` call in Task 3; fixture marker string in Task 1 matches Task 2's test expectation; MIN_PROFILE_CHARS=200 matches the ≥6 fixture lines (~340 chars of text).
- **Known judgment call:** whitespace normalization preserves newlines (design said "collapse runs, trim" — the newline-preserving variant keeps CV section structure readable in the prompt; the test pins this with the no-horizontal-runs assertion).
