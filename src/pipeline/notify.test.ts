import { describe, expect, it } from 'vitest';
import type { JobPosting, JobRecord } from '../types';
import { formatAlertMessage, formatDigestMessage } from './notify';

const posting: JobPosting = {
  id: 'x:1', source: 'x', url: 'https://example.com/job', title: 'Senior Frontend Engineer',
  company: 'Acme', location: 'Berlin', workMode: 'hybrid', description: 'd', postedAt: '2026-06-10T00:00:00Z',
};

const record: JobRecord = {
  posting,
  fuzzyKey: 'k',
  status: 'scored',
  score: { score: 85, stackFit: 90, seniorityFit: 80, locationFit: 90, reasoning: 'Strong React/TS match', language: 'en' },
  matchFile: 'matches/2026-06-10-acme-senior-frontend-engineer.md',
  languageFlag: 'de',
  firstSeenAt: '2026-06-10T08:00:00Z',
  updatedAt: '2026-06-10T08:00:00Z',
};

describe('formatAlertMessage', () => {
  it('includes score, role, reasoning, url, match file and language flag', () => {
    const msg = formatAlertMessage(record);
    expect(msg).toContain('85/100');
    expect(msg).toContain('Senior Frontend Engineer @ Acme');
    expect(msg).toContain('Strong React/TS match');
    expect(msg).toContain('https://example.com/job');
    expect(msg).toContain('matches/2026-06-10-acme-senior-frontend-engineer.md');
    expect(msg).toContain('German');
  });
});

describe('formatDigestMessage', () => {
  it('ranks jobs and appends source warnings', () => {
    const msg = formatDigestMessage([record], ['adzuna']);
    expect(msg).toContain('1.');
    expect(msg).toContain('85');
    expect(msg).toContain('⚠️ Source failing: adzuna');
  });

  it('says so when there are no matches', () => {
    expect(formatDigestMessage([], [])).toContain('No new matches');
  });
});
