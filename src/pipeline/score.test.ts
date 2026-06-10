import { describe, expect, it } from 'vitest';
import type { JobPosting } from '../types';
import { buildScoringMessages, ScoreSchema, scoreJob, type ScoringClient } from './score';

const posting: JobPosting = {
  id: 'x:1',
  source: 'x',
  url: 'https://example.com',
  title: 'Senior Frontend Engineer',
  company: 'Acme',
  location: 'Berlin',
  workMode: 'hybrid',
  description: 'React + TypeScript product team.',
  postedAt: '2026-06-10T00:00:00.000Z',
};

describe('buildScoringMessages', () => {
  it('puts profile in the stable system prompt and the job in the user turn', () => {
    const messages = buildScoringMessages('PROFILE TEXT', posting);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('PROFILE TEXT');
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toContain('Senior Frontend Engineer');
    expect(messages[1]?.content).toContain('Acme');
  });
});

describe('ScoreSchema', () => {
  it('rejects out-of-range scores', () => {
    expect(
      ScoreSchema.safeParse({ score: 150, stackFit: 0, seniorityFit: 0, locationFit: 0, reasoning: 'r', language: 'en' })
        .success,
    ).toBe(false);
  });
});

describe('scoreJob', () => {
  it('returns the parsed result from the client', async () => {
    const fake: ScoringClient = {
      parse: async () => ({
        choices: [
          {
            message: {
              parsed: { score: 85, stackFit: 90, seniorityFit: 80, locationFit: 90, reasoning: 'Strong fit', language: 'en' },
            },
          },
        ],
      }),
    };
    const result = await scoreJob(fake, 'gpt-test', 'PROFILE', posting);
    expect(result.score).toBe(85);
  });

  it('throws when the client returns nothing parseable', async () => {
    const fake: ScoringClient = { parse: async () => ({ choices: [] }) };
    await expect(scoreJob(fake, 'gpt-test', 'PROFILE', posting)).rejects.toThrow(/no parsed result/);
  });

  it('throws when the client returns parsed: null', async () => {
    const fake: ScoringClient = { parse: async () => ({ choices: [{ message: { parsed: null } }] }) };
    await expect(scoreJob(fake, 'gpt-test', 'PROFILE', posting)).rejects.toThrow(/no parsed result/);
  });
});
