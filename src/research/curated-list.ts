import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { ResearchedCompany } from './top-companies';

export const CURATED_DIR = 'data';
const CURATED_PREFIX = 'top-companies';

// Curated lists state comp as a number, a numeric string, or a "min-max"
// range string — normalize all of them to a number (range → midpoint).
const CompSchema = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const parts = String(value).split('-').map((p) => Number(p.trim()));
  if (parts.length === 0 || parts.some((n) => !Number.isFinite(n) || n <= 0)) {
    ctx.addIssue({ code: 'custom', message: `unparseable comp: ${String(value)}` });
    return z.NEVER;
  }
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
});

export const CuratedCompanySchema = z.object({
  rank: z.number().optional(),
  name: z.string().min(1),
  reason: z.string(),
  estSeniorTotalCompEur: CompSchema,
  germanyPresence: z.enum(['office', 'remote-eu']),
  ats: z.enum(['greenhouse', 'lever', 'personio', 'other', 'unknown']),
  atsNote: z.string().optional(),
  slugGuesses: z.array(z.string()).default([]),
});

export const CuratedFileSchema = z.object({
  companies: z.array(CuratedCompanySchema).min(1),
});

function normalizeName(name: string): string {
  return name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function curatedListFiles(dir = CURATED_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(CURATED_PREFIX) && f.endsWith('.json'))
    .sort()
    .map((f) => join(dir, f));
}

// Union of all curated lists. The same company in several lists ("HashiCorp"
// vs "HashiCorp (IBM)") is matched by normalized-name containment; the first
// file (alphabetical) wins on conflicting fields, but slug guesses are pooled
// so board discovery gets every candidate.
export function loadCuratedCompanies(dir = CURATED_DIR): ResearchedCompany[] {
  const merged: { key: string; company: ResearchedCompany }[] = [];
  for (const file of curatedListFiles(dir)) {
    const parsed = CuratedFileSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    for (const c of parsed.companies) {
      const key = normalizeName(c.name);
      const existing = key
        ? merged.find((m) => m.key && (m.key.includes(key) || key.includes(m.key)))
        : undefined;
      if (existing) {
        existing.company.ats.slugGuesses = [
          ...new Set([...existing.company.ats.slugGuesses, ...c.slugGuesses]),
        ];
        continue;
      }
      merged.push({
        key,
        company: {
          name: c.name,
          reason: c.reason,
          estSeniorTotalCompEur: c.estSeniorTotalCompEur,
          germanyPresence: c.germanyPresence,
          ats: { vendor: c.ats, slugGuesses: [...c.slugGuesses] },
        },
      });
    }
  }
  return merged.map((m) => m.company).sort((a, b) => b.estSeniorTotalCompEur - a.estSeniorTotalCompEur);
}
