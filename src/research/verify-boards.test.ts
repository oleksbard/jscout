import { describe, expect, it } from 'vitest';
import { namesMatch, slugVariants, buildBoardCache, discoverBoards, type ProbeFn } from './verify-boards';
import type { CompaniesFile } from './companies-file';
import type { ResearchedCompany } from './top-companies';

function company(name: string, vendor: ResearchedCompany['ats']['vendor'], guesses: string[]): ResearchedCompany {
  return {
    name,
    reason: 'r',
    estSeniorTotalCompEur: 100000,
    germanyPresence: 'office',
    ats: { vendor, slugGuesses: guesses },
  };
}

describe('slugVariants', () => {
  it('puts LLM guesses first, then collapsed and dashed name forms', () => {
    expect(slugVariants('Trade Republic', ['traderepublic'])).toEqual([
      'traderepublic',
      'trade-republic',
    ]);
  });

  it('folds umlauts and strips punctuation', () => {
    expect(slugVariants('Müller & Söhne GmbH', [])).toEqual([
      'mullersohnegmbh',
      'muller-sohne-gmbh',
    ]);
  });

  it('drops invalid guesses and dedupes, capped at 6', () => {
    const variants = slugVariants('Acme', ['ACME', 'acme!!', 'a', 'b', 'c', 'd', 'e']);
    expect(variants[0]).toBe('acme');
    expect(variants).not.toContain('acme!!');
    expect(variants.length).toBeLessThanOrEqual(6);
    expect(new Set(variants).size).toBe(variants.length);
  });
});

describe('namesMatch', () => {
  it('matches when one normalized name contains the other', () => {
    expect(namesMatch('Stripe, Inc.', 'Stripe')).toBe(true);
    expect(namesMatch('Datadog', 'Datadog Germany')).toBe(true);
  });

  it('rejects unrelated names and empty strings', () => {
    expect(namesMatch('Initech', 'Stripe')).toBe(false);
    expect(namesMatch('', 'Stripe')).toBe(false);
  });
});

describe('buildBoardCache', () => {
  it('maps lowercased names to verified boards, skipping board-less entries', () => {
    const previous: CompaniesFile = {
      updatedAt: '2026-06-03T05:00:00.000Z',
      companies: [
        { name: 'Stripe', reason: 'r', estSeniorTotalCompEur: 1, germanyPresence: 'remote-eu', board: { vendor: 'greenhouse', slug: 'stripe' } },
        { name: 'Celonis', reason: 'r', estSeniorTotalCompEur: 1, germanyPresence: 'office', board: null },
      ],
    };
    expect(buildBoardCache(previous)).toEqual({ stripe: { vendor: 'greenhouse', slug: 'stripe' } });
  });

  it('is safe for companies named after Object.prototype keys', () => {
    const previous: CompaniesFile = {
      updatedAt: '2026-06-03T05:00:00.000Z',
      companies: [
        { name: 'Constructor', reason: 'r', estSeniorTotalCompEur: 1, germanyPresence: 'office', board: null },
      ],
    };
    expect(buildBoardCache(previous)['constructor']).toBeUndefined();
  });
});

describe('discoverBoards', () => {
  it('uses the cache without probing', async () => {
    let probed = 0;
    const probe: ProbeFn = async () => {
      probed += 1;
      return 'miss';
    };
    const cache = { stripe: { vendor: 'greenhouse', slug: 'stripe' } as const };
    const [entry] = await discoverBoards([company('Stripe', 'greenhouse', ['stripe'])], cache, probe);
    expect(entry?.board).toEqual({ vendor: 'greenhouse', slug: 'stripe' });
    expect(probed).toBe(0);
  });

  it('probes the claimed vendor first and stops at the first hit', async () => {
    const calls: string[] = [];
    const probe: ProbeFn = async (vendor, slug) => {
      calls.push(`${vendor}:${slug}`);
      return vendor === 'lever' && slug === 'acme' ? 'hit' : 'miss';
    };
    const [entry] = await discoverBoards([company('Acme', 'lever', ['acme'])], {}, probe);
    expect(entry?.board).toEqual({ vendor: 'lever', slug: 'acme' });
    expect(calls).toEqual(['lever:acme']);
  });

  it('returns board null when nothing verifies', async () => {
    const probe: ProbeFn = async () => 'miss';
    const [entry] = await discoverBoards([company('Acme', 'unknown', [])], {}, probe);
    expect(entry?.board).toBeNull();
  });

  it('throws when every probe errors (network wipe-out)', async () => {
    const probe: ProbeFn = async () => 'error';
    await expect(discoverBoards([company('Acme', 'unknown', [])], {}, probe)).rejects.toThrow(/probes errored/);
  });

  it('does not throw when some probes miss normally', async () => {
    const probe: ProbeFn = async (vendor) => (vendor === 'personio' ? 'error' : 'miss');
    const [entry] = await discoverBoards([company('Acme', 'unknown', [])], {}, probe);
    expect(entry?.board).toBeNull();
  });
});
