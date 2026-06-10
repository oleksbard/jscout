import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/jsearch.json';
import { normalizeJsearch } from './jsearch';

describe('normalizeJsearch', () => {
  it('maps Google-for-Jobs results to JobPosting', () => {
    const [job] = normalizeJsearch(fixture);
    expect(job).toMatchObject({
      id: 'jsearch:abc123==',
      source: 'jsearch',
      title: 'Staff Software Engineer, Frontend',
      company: 'Gamma Labs',
      location: 'Berlin, DE',
      workMode: 'remote',
      url: 'https://www.stepstone.de/job/12345',
    });
  });
});
