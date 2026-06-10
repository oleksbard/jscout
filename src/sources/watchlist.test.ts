import { describe, expect, it } from 'vitest';
import greenhouse from '../../fixtures/greenhouse.json';
import lever from '../../fixtures/lever.json';
import personio from '../../fixtures/personio.json';
import { normalizeGreenhouse, normalizeLever, normalizePersonio } from './watchlist';

describe('watchlist normalizers', () => {
  it('greenhouse', () => {
    const [job] = normalizeGreenhouse('acme', greenhouse);
    expect(job).toMatchObject({
      id: 'greenhouse:acme:555',
      source: 'greenhouse',
      company: 'acme',
      title: 'Senior Product Engineer',
      location: 'Berlin, Germany',
      url: 'https://boards.greenhouse.io/acme/jobs/555',
    });
    expect(job?.description).toBe('React, TypeScript, Node.');
  });

  it('lever', () => {
    const [job] = normalizeLever('acme', lever);
    expect(job).toMatchObject({
      id: 'lever:acme:lever-uuid-1',
      source: 'lever',
      title: 'Engineering Manager, Web',
      location: 'Remote - Germany',
      workMode: 'remote',
    });
  });

  it('personio', () => {
    const [job] = normalizePersonio('acme', personio);
    expect(job).toMatchObject({
      id: 'personio:acme:777',
      source: 'personio',
      title: 'Senior Fullstack Engineer (m/w/d)',
      location: 'Berlin',
    });
    expect(job?.description).toBe('TypeScript across the stack.');
  });
});
