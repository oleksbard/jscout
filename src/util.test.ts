import { describe, expect, it } from 'vitest';
import { slugify, stripHtml } from './util';

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
