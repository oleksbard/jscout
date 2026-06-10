import { describe, expect, it } from 'vitest';
import type { JobPosting, ScoreResult } from '../types';
import { buildMatchMarkdown, buildTailoringMessages, matchFilename, tailorJob, type TailoringClient } from './tailor';

const posting: JobPosting = {
  id: 'x:1',
  source: 'x',
  url: 'https://example.com/job',
  title: 'Senior Frontend Engineer',
  company: 'Acme GmbH',
  location: 'Berlin',
  workMode: 'hybrid',
  description: 'React + TypeScript.',
  postedAt: '2026-06-10T00:00:00.000Z',
};

const score: ScoreResult = { score: 85, stackFit: 90, seniorityFit: 80, locationFit: 90, reasoning: 'Strong fit', language: 'en' };

describe('matchFilename', () => {
  it('builds a dated slug path', () => {
    expect(matchFilename(posting, '2026-06-10')).toBe('matches/2026-06-10-acme-gmbh-senior-frontend-engineer.md');
  });
});

describe('buildTailoringMessages', () => {
  it('includes profile, posting, and asks for English output', () => {
    const messages = buildTailoringMessages('PROFILE', posting, score);
    expect(messages[0]?.content).toContain('PROFILE');
    expect(messages[0]?.content).toContain('English');
    expect(messages[1]?.content).toContain('Acme GmbH');
  });
});

describe('buildMatchMarkdown', () => {
  it('wraps LLM output with metadata header', () => {
    const md = buildMatchMarkdown(posting, score, 'LLM BODY');
    expect(md).toContain('# Senior Frontend Engineer @ Acme GmbH');
    expect(md).toContain('Score: 85/100');
    expect(md).toContain('https://example.com/job');
    expect(md).toContain('LLM BODY');
  });

  it('adds the German-language flag bullet only for de postings', () => {
    expect(buildMatchMarkdown(posting, { ...score, language: 'de' }, 'BODY')).toContain('German-language posting');
    expect(buildMatchMarkdown(posting, score, 'BODY')).not.toContain('German-language posting');
  });
});

describe('tailorJob', () => {
  it('returns markdown produced by the client', async () => {
    const fake: TailoringClient = { complete: async () => 'COVER LETTER TEXT' };
    const md = await tailorJob(fake, 'gpt-test', 'PROFILE', posting, score);
    expect(md).toContain('COVER LETTER TEXT');
    expect(md).toContain('Score: 85/100');
  });
});
