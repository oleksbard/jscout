# Profile as PDF (Design)

Date: 2026-06-10
Status: Approved (brainstormed with Oleksandr)
Builds on: docs/2026-06-10-job-scout-design.md

## 1. Goal

The pipeline reads the candidate profile from `profile.pdf` (an exported CV)
instead of `profile.md`. One source of truth: drop the real CV into the repo,
no manual markdown transcription.

## 2. Decisions

| Dimension | Decision |
|---|---|
| Source | `profile.pdf` at repo root, PDF only. `profile.md` is deleted. |
| PDF type | Digitally exported (text layer required). Scanned PDFs / OCR out of scope — fail with a clear error. |
| Library | `unpdf` (ESM-first wrapper around Mozilla pdf.js; zero native deps; works on GitHub Actions runners with no system packages). |
| Committed? | Yes — CI checks the repo out, so `profile.pdf` must be committed (private repo, accepted). |

## 3. Components

### `src/profile.ts` (new)

- `loadProfile(path?: string): Promise<string>` — default path `profile.pdf`.
  - Missing file → throw `profile: <path> not found — export your CV as profile.pdf`.
  - Extract text with `unpdf`'s `extractText` (merged pages).
  - Normalize whitespace (collapse runs, trim) — extracted CV text is messy;
    the LLM tolerates it, but no need to waste tokens on blank runs.
  - Extracted text shorter than 200 chars → throw
    `profile: no text layer found in <path> (scanned PDF?)` — fail fast
    instead of scoring against an empty profile.

### `src/run.ts` (edit)

- `PROFILE_PATH = 'profile.pdf'`.
- Real runs: `await loadProfile(PROFILE_PATH)` at startup, before any
  network/LLM work (same fail-fast position as the Telegram secrets check).
- Dry-run: unchanged `'dry-run profile'` stub — dry-run never reads the file.

### Removals / docs

- Delete `profile.md`.
- README setup step 1 becomes: export your CV as `profile.pdf` at the repo root
  (text-based export, not a scan).

## 4. Error handling

`loadProfile` errors throw at startup → exit code 1 → no state mutated, no
API spend → GitHub default failure email (consistent with design doc §6).

## 5. Testing

- Fixture: `fixtures/profile.pdf` — tiny one-page text PDF committed to the repo.
- `src/profile.test.ts` (offline, like all tests):
  - extracts text from the fixture (contains a known marker string),
  - missing file → rejects with /not found/,
  - PDF with no meaningful text → rejects with /no text layer/.

## 6. Out of scope

- OCR for scanned PDFs.
- Multiple profile files / fallback to markdown.
- Any change to prompt structure — `profile` stays a plain string fed to the
  existing scoring/tailoring system prompts.
