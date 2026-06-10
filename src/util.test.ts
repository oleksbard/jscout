import { describe, expect, it } from 'vitest';
import { mapWithConcurrency, slugify, stripHtml } from './util';

describe('stripHtml', () => {
  it('strips tags and collapses whitespace', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>\n<ul><li>x</li></ul>')).toBe('Hello world x');
  });

  it('decodes common entities', () => {
    expect(stripHtml('R&amp;D &lt;team&gt;')).toBe('R&D <team>');
  });
});

describe('slugify', () => {
  it('lowercases and replaces non-alphanumerics with dashes', () => {
    expect(slugify('Acme GmbH')).toBe('acme-gmbh');
    expect(slugify('Senior Frontend Engineer (m/w/d)')).toBe('senior-frontend-engineer-m-w-d');
  });

  it('trims leading/trailing dashes and caps length at 40', () => {
    expect(slugify('---hello---')).toBe('hello');
    expect(slugify('a'.repeat(50))).toHaveLength(40);
  });

  it('returns empty string for all-special-character input', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('mapWithConcurrency', () => {
  it('preserves order and maps all items', async () => {
    const result = await mapWithConcurrency([30, 10, 20], 2, async (n) => {
      await new Promise((resolve) => setTimeout(resolve, n));
      return n / 10;
    });
    expect(result).toEqual([3, 1, 2]);
  });

  it('never runs more than the limit concurrently', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    });
    expect(maxInFlight).toBe(3);
  });

  it('handles limit larger than item count and empty input', async () => {
    expect(await mapWithConcurrency([1], 10, async (n) => n + 1)).toEqual([2]);
    expect(await mapWithConcurrency([], 4, async () => 'x')).toEqual([]);
  });
});
