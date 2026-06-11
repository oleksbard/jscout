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

  it('maps a missing company to an empty string', () => {
    const entry = { ...(fixture as Record<string, unknown>[])[1], company: undefined };
    const [job] = normalizeRemoteok([entry]);
    expect(job?.company).toBe('');
  });
});
