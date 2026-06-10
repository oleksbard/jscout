# Scoring & Filter Tuning (Design)

Date: 2026-06-10
Status: Approved (brainstormed with Oleksandr)
Builds on: docs/2026-06-10-job-scout-design.md

## 1. Goal

Encode Oleksandr's actual search criteria in both the zero-cost hard filter and
the LLM scoring rubric:

- Roles: senior+ frontend or full-stack with TypeScript, React, Node.js;
  Staff/Lead/Principal on that stack; hands-on (still-coding) Engineering
  Manager on that stack. Pure people-management EM roles out of scope.
- No onsite roles anywhere — including Berlin.
- Hybrid only in Berlin (was: anywhere in Germany).
- Remote: EU only; drop remotes that are clearly outside the EU.
- Salary: if stated, at least €100k/year.

## 2. Decisions

| Dimension | Decision |
|---|---|
| Location rules | onsite → always drop; hybrid → Berlin only; remote → EU (unchanged); unknown mode → Berlin only (was Germany-wide). |
| Non-EU remotes | NON_EU_HINTS check moves ahead of the mode rules but is skipped when the location mentions Berlin (multi-office "Berlin or New York" postings survive). List expanded: switzerland, singapore, japan, china, uae, dubai, israel, brazil, mexico, asia, apac, africa, middle east. |
| Salary floor | New config `minSalaryEur` (loader default 0 = disabled; shipped config.json sets 100000). New pure `meetsSalaryFloor(salary, floor)` in filter.ts: no salary string → pass; else parse numbers, take the max of the range, drop if max < floor. Structured salary only comes from Adzuna in our own `"min–max"` format. In-text salaries are judged by the scorer. |
| Rubric | Rewritten in-scope-roles line (TS/React/Node, senior+, hands-on EM; other stacks / pure-people EM out of scope); location line (remote EU or Berlin hybrid; onsite-only → score below 40); new salary line (stated comp < €100k/year → score below 60; unstated neutral). Prompt remains a static prefix (caching unaffected). |
| GERMANY_HINTS | No longer needed by matchesLocation (subsumed by EU_HINTS); keep the constant only as part of EU_HINTS composition. |
| Existing state | Old scores in state/jobs.json are not re-scored; new rules apply to newly fetched jobs. |

## 3. Components

- `src/pipeline/filter.ts`: matchesLocation rewrite; meetsSalaryFloor added;
  hardFilter additionally filters on meetsSalaryFloor.
- `src/config.ts` + `config.json`: `minSalaryEur` field.
- `src/pipeline/score.ts`: rubric lines in buildScoringMessages.
- `README.md`: Tuning section gains `minSalaryEur`.

## 4. Testing

- matchesLocation truth table: Berlin onsite → false; Munich hybrid → false;
  Berlin hybrid → true; Hamburg/Madrid unknown → false; Berlin unknown → true;
  EU remote → true; empty-location remote → true; 'Remote, USA' / 'Remote,
  Singapore' → false; 'Berlin or New York, USA' hybrid → true.
- meetsSalaryFloor: undefined → true; '75000–90000' vs 100000 → false;
  '95000–120000' vs 100000 → true; floor 0 → always true; non-numeric → true.
- Config: default minSalaryEur 0; explicit 100000 kept.
- Scoring prompt: contains 'hands-on', 'Berlin', '€100,000'.

## 5. Out of scope

- Currency conversion (Adzuna DE is EUR; in-text currencies judged by scorer).
- Re-scoring jobs already in state.
- titleInclude/titleExclude changes (current lists already pass the target
  titles; stack mismatches are the scorer's job).
