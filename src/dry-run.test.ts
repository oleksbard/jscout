import { describe, expect, it } from 'vitest';
import { fakeScore, loadFixturePostings } from './dry-run';

describe('loadFixturePostings', () => {
  it('loads and normalizes all source fixtures', () => {
    const postings = loadFixturePostings();
    const sources = new Set(postings.map((p) => p.source));
    expect(sources).toEqual(new Set(['arbeitnow', 'remoteok', 'adzuna', 'jsearch', 'hn', 'greenhouse', 'lever', 'personio']));
    expect(postings.length).toBeGreaterThanOrEqual(8);
  });
});

describe('fakeScore', () => {
  it('is deterministic per posting id', () => {
    const postings = loadFixturePostings();
    const a = fakeScore(postings[0]!);
    const b = fakeScore(postings[0]!);
    expect(a).toEqual(b);
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(100);
  });
});
