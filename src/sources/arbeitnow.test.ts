import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/arbeitnow.json';
import { normalizeArbeitnow } from './arbeitnow';

describe('normalizeArbeitnow', () => {
  it('maps API payload to JobPosting', () => {
    const [job] = normalizeArbeitnow(fixture);
    expect(job).toEqual({
      id: 'arbeitnow:senior-frontend-engineer-acme-berlin',
      source: 'arbeitnow',
      url: 'https://www.arbeitnow.com/jobs/companies/acme/senior-frontend-engineer',
      title: 'Senior Frontend Engineer (m/w/d)',
      company: 'Acme GmbH',
      location: 'Berlin',
      workMode: 'remote',
      description: 'We build with React and TypeScript.',
      postedAt: new Date(1765400000 * 1000).toISOString(),
    });
  });
});
