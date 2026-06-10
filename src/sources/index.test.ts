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
    expect(daily).toContain('hn');
    expect(daily).not.toContain('remoteok');
    expect(daily).toContain('jsearch');

    const intraday = buildSourceTasks(config, { includeJsearch: false }).map((t) => t.name);
    expect(intraday).not.toContain('jsearch');
  });
});
