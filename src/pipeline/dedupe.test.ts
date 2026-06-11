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

  it('tolerates a malformed posting with missing company or title', () => {
    expect(fuzzyKey(posting({ company: undefined as unknown as string }))).toBe('|senior frontend engineer');
    expect(fuzzyKey(posting({ title: undefined as unknown as string }))).toBe('acme|');
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
