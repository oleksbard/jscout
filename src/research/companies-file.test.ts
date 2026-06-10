import { mkdtempSync, writeFileSync } from 'node:fs';
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

  it('degrades to empty on malformed JSON', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'job-scout-')), 'companies.json');
    writeFileSync(path, '{ not json');
    expect(loadCompaniesFile(path)).toEqual(emptyCompaniesFile());
  });

  it('degrades to empty when companies is not an array', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'job-scout-')), 'companies.json');
    writeFileSync(path, JSON.stringify({ updatedAt: 'x', companies: null }));
    expect(loadCompaniesFile(path)).toEqual(emptyCompaniesFile());
  });
});
