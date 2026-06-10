import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { JobPosting } from '../types';
import { addJob, clearSourceFailure, emptyState, loadState, recordSourceFailure, saveState, setStatus } from './state';

const posting: JobPosting = {
  id: 'arbeitnow:abc',
  source: 'arbeitnow',
  url: 'https://example.com/job',
  title: 'Senior Frontend Engineer',
  company: 'Acme GmbH',
  location: 'Berlin',
  workMode: 'hybrid',
  description: 'React and TypeScript role',
  postedAt: '2026-06-10T00:00:00.000Z',
};

describe('state store', () => {
  it('returns empty state when file does not exist', () => {
    const state = loadState(join(tmpdir(), 'does-not-exist', 'jobs.json'));
    expect(state).toEqual(emptyState());
  });

  it('round-trips state through disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'job-scout-state-'));
    const path = join(dir, 'state', 'jobs.json');
    const state = emptyState();
    addJob(state, posting, 'acme|senior frontend engineer', 'de');
    saveState(path, state);
    const loaded = loadState(path);
    expect(loaded.jobs['arbeitnow:abc']?.status).toBe('seen');
    expect(loaded.jobs['arbeitnow:abc']?.languageFlag).toBe('de');
    expect(loaded.jobs['arbeitnow:abc']?.fuzzyKey).toBe('acme|senior frontend engineer');
  });

  it('setStatus advances status and bumps updatedAt', () => {
    const state = emptyState();
    const record = addJob(state, posting, 'k');
    const before = record.updatedAt;
    setStatus(record, 'scored');
    expect(record.status).toBe('scored');
    expect(record.updatedAt >= before).toBe(true);
  });

  it('tracks consecutive source failures and clears them', () => {
    const state = emptyState();
    recordSourceFailure(state, 'adzuna', 'HTTP 500');
    recordSourceFailure(state, 'adzuna', 'HTTP 429');
    expect(state.sourceFailures['adzuna']).toEqual({ consecutiveFailures: 2, lastError: 'HTTP 429' });
    clearSourceFailure(state, 'adzuna');
    expect(state.sourceFailures['adzuna']).toBeUndefined();
  });

  it('loadState fills in missing top-level fields from older files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'job-scout-state-'));
    const path = join(dir, 'jobs.json');
    writeFileSync(path, JSON.stringify({ jobs: {} }));
    expect(loadState(path).sourceFailures).toEqual({});
  });
});
