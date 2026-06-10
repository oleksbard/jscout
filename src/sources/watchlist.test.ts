import { describe, expect, it } from 'vitest';
import greenhouse from '../../fixtures/greenhouse.json';
import lever from '../../fixtures/lever.json';
import personio from '../../fixtures/personio.json';
import type { CompaniesFile } from '../research/companies-file';
import { mergeWatchlist, normalizeGreenhouse, normalizeLever, normalizePersonio } from './watchlist';

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
