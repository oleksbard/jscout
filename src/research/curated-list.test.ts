import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { curatedListFiles, loadCuratedCompanies } from './curated-list';

function curatedDir(...files: { name: string; companies: unknown[] }[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'job-scout-curated-'));
  for (const f of files) {
    writeFileSync(join(dir, f.name), JSON.stringify({ meta: { ignored: true }, companies: f.companies }));
  }
  return dir;
}

function company(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    rank: 1,
    name: 'Acme',
    reason: 'r',
    estSeniorTotalCompEur: 150000,
    germanyPresence: 'office',
    ats: 'greenhouse',
    slugGuesses: ['acme'],
    ...overrides,
  };
}

describe('curatedListFiles', () => {
  it('returns empty for a missing directory', () => {
    expect(curatedListFiles(join(tmpdir(), 'job-scout-nope'))).toEqual([]);
  });

  it('lists only top-companies*.json, sorted', () => {
    const dir = curatedDir(
      { name: 'top-companies-2.json', companies: [company({})] },
      { name: 'top-companies.json', companies: [company({})] },
    );
    writeFileSync(join(dir, 'other.json'), '{}');
    expect(curatedListFiles(dir)).toEqual([join(dir, 'top-companies-2.json'), join(dir, 'top-companies.json')]);
  });
});

describe('loadCuratedCompanies', () => {
  it('maps entries to researched companies, sorted by comp desc', () => {
    const dir = curatedDir({
      name: 'top-companies.json',
      companies: [
        company({ name: 'Low', estSeniorTotalCompEur: 100000, ats: 'other', slugGuesses: [] }),
        company({ name: 'High', estSeniorTotalCompEur: 200000, atsNote: 'extra fields tolerated' }),
      ],
    });
    expect(loadCuratedCompanies(dir)).toEqual([
      {
        name: 'High',
        reason: 'r',
        estSeniorTotalCompEur: 200000,
        germanyPresence: 'office',
        ats: { vendor: 'greenhouse', slugGuesses: ['acme'] },
      },
      {
        name: 'Low',
        reason: 'r',
        estSeniorTotalCompEur: 100000,
        germanyPresence: 'office',
        ats: { vendor: 'other', slugGuesses: [] },
      },
    ]);
  });

  it('coerces string comps and takes the midpoint of ranges', () => {
    const dir = curatedDir({
      name: 'top-companies.json',
      companies: [
        company({ name: 'Range', estSeniorTotalCompEur: '350000-450000' }),
        company({ name: 'Plain', estSeniorTotalCompEur: '300000' }),
      ],
    });
    const [range, plain] = loadCuratedCompanies(dir);
    expect(range?.estSeniorTotalCompEur).toBe(400000);
    expect(plain?.estSeniorTotalCompEur).toBe(300000);
  });

  it('rejects unparseable comp values', () => {
    const dir = curatedDir({
      name: 'top-companies.json',
      companies: [company({ estSeniorTotalCompEur: 'lots' })],
    });
    expect(() => loadCuratedCompanies(dir)).toThrow(/unparseable comp/);
  });

  it('merges files: fuzzy-name dedupe, pooled slugs, first file wins', () => {
    const dir = curatedDir(
      {
        name: 'top-companies-a.json',
        companies: [
          company({ name: 'HashiCorp (IBM)', estSeniorTotalCompEur: 125000, slugGuesses: ['hashicorp'] }),
          company({ name: 'OnlyInA', estSeniorTotalCompEur: 180000 }),
        ],
      },
      {
        name: 'top-companies-b.json',
        companies: [
          company({ name: 'HashiCorp', estSeniorTotalCompEur: 175000, slugGuesses: ['hashicorp', 'hashicorp-ibm'] }),
          company({ name: 'OnlyInB', estSeniorTotalCompEur: 190000 }),
        ],
      },
    );
    const companies = loadCuratedCompanies(dir);
    expect(companies.map((c) => c.name)).toEqual(['OnlyInB', 'OnlyInA', 'HashiCorp (IBM)']);
    const hashicorp = companies.find((c) => c.name === 'HashiCorp (IBM)');
    expect(hashicorp?.estSeniorTotalCompEur).toBe(125000);
    expect(hashicorp?.ats.slugGuesses).toEqual(['hashicorp', 'hashicorp-ibm']);
  });
});
