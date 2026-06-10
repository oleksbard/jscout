import { describe, expect, it } from 'vitest';
import type { JobPosting, JobRecord, State } from '../types';
import { selectAlertJobs, selectDigestJobs } from './select';

function record(id: string, score: number, status: JobRecord['status'], firstSeenAt: string): JobRecord {
  const posting: JobPosting = {
    id, source: 's', url: 'u', title: 't', company: 'c', location: 'Berlin',
    workMode: 'remote', description: 'd', postedAt: firstSeenAt,
  };
  return {
    posting,
    fuzzyKey: id,
    status,
    score: { score, stackFit: score, seniorityFit: score, locationFit: score, reasoning: 'r', language: 'en' },
    firstSeenAt,
    updatedAt: firstSeenAt,
  };
}

function state(records: JobRecord[]): State {
  return { jobs: Object.fromEntries(records.map((r) => [r.posting.id, r])), sourceFailures: {} };
}

describe('selectAlertJobs', () => {
  it('picks scored jobs at or above hot threshold only', () => {
    const s = state([
      record('a', 85, 'scored', '2026-06-10T08:00:00Z'),
      record('b', 70, 'scored', '2026-06-10T08:00:00Z'),
      record('c', 90, 'alerted', '2026-06-10T08:00:00Z'), // already alerted
    ]);
    expect(selectAlertJobs(s, 80).map((r) => r.posting.id)).toEqual(['a']);
  });
});

describe('selectDigestJobs', () => {
  it('picks recent scored+alerted jobs above digest threshold, sorted by score desc', () => {
    const s = state([
      record('a', 65, 'scored', '2026-06-10T08:00:00Z'),
      record('b', 90, 'alerted', '2026-06-10T09:00:00Z'),
      record('c', 50, 'scored', '2026-06-10T08:00:00Z'), // below threshold
      record('d', 95, 'scored', '2026-06-01T08:00:00Z'), // too old
      record('e', 88, 'digested', '2026-06-10T08:00:00Z'), // already digested
    ]);
    const picked = selectDigestJobs(s, 60, '2026-06-09T12:00:00Z');
    expect(picked.map((r) => r.posting.id)).toEqual(['b', 'a']);
  });
});
