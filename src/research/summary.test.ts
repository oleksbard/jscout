import { describe, expect, it } from 'vitest';
import type { CompaniesFile, CompanyEntry } from './companies-file';
import { diffCompanies, formatCompaniesMessage } from './summary';

function entry(name: string, board: CompanyEntry['board'] = null): CompanyEntry {
  return { name, reason: 'r', estSeniorTotalCompEur: 150000, germanyPresence: 'office', board };
}

function file(...companies: CompanyEntry[]): CompaniesFile {
  return { updatedAt: '2026-06-10T05:00:00.000Z', companies };
}

describe('diffCompanies', () => {
  it('reports added and dropped names, case-insensitively', () => {
    const previous = file(entry('Stripe'), entry('Celonis'));
    const current = file(entry('stripe'), entry('Datadog'));
    expect(diffCompanies(previous, current)).toEqual({ added: ['Datadog'], dropped: ['Celonis'] });
  });

  it('is empty for identical lists', () => {
    const f = file(entry('Stripe'));
    expect(diffCompanies(f, f)).toEqual({ added: [], dropped: [] });
  });
});

describe('formatCompaniesMessage', () => {
  it('lists ranked companies with comp, presence, and board', () => {
    const current = file(entry('Stripe', { vendor: 'greenhouse', slug: 'stripe' }), entry('Celonis'));
    const message = formatCompaniesMessage(current, { added: ['Stripe'], dropped: ['Initech'] });
    expect(message).toContain('2 companies');
    expect(message).toContain('1. Stripe — ~€150k (office, greenhouse:stripe)');
    expect(message).toContain('2. Celonis — ~€150k (office, no board found)');
    expect(message).toContain('➕ New: Stripe');
    expect(message).toContain('➖ Dropped: Initech');
    expect(message).toContain('1 without a discoverable job board');
  });

  it('omits diff and no-board lines when empty', () => {
    const current = file(entry('Stripe', { vendor: 'greenhouse', slug: 'stripe' }));
    const message = formatCompaniesMessage(current, { added: [], dropped: [] });
    expect(message).not.toContain('➕');
    expect(message).not.toContain('➖');
    expect(message).not.toContain('without a discoverable');
  });
});
