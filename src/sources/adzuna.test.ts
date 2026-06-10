import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/adzuna.json';
import { normalizeAdzuna } from './adzuna';

describe('normalizeAdzuna', () => {
  it('maps results, infers workMode from description, formats salary', () => {
    const [job] = normalizeAdzuna(fixture);
    expect(job).toMatchObject({
      id: 'adzuna:987654',
      source: 'adzuna',
      title: 'Senior Fullstack Developer (React/Node)',
      company: 'Beta Tech GmbH',
      location: 'Hamburg, Deutschland',
      workMode: 'hybrid',
      url: 'https://www.adzuna.de/land/ad/987654',
      salary: '75000–90000',
    });
  });
});
