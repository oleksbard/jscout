import { describe, expect, it } from 'vitest';
import type { Config } from '../config';
import type { JobPosting } from '../types';
import { detectGerman, hardFilter, matchesLocation, matchesTitle } from './filter';

const config = {
  titleInclude: ['frontend', 'react', 'engineering manager'],
  titleExclude: ['intern', 'php'],
} as Pick<Config, 'titleInclude' | 'titleExclude'> as Config;

function posting(overrides: Partial<JobPosting>): JobPosting {
  return {
    id: 'x:1',
    source: 'x',
    url: 'https://example.com',
    title: 'Senior Frontend Engineer',
    company: 'Acme',
    location: 'Berlin, Germany',
    workMode: 'remote',
    description: 'We build things with React and TypeScript.',
    postedAt: '2026-06-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('matchesTitle', () => {
  it('accepts included keywords, rejects excluded ones', () => {
    expect(matchesTitle('Senior Frontend Engineer', config)).toBe(true);
    expect(matchesTitle('Engineering Manager', config)).toBe(true);
    expect(matchesTitle('Frontend Intern', config)).toBe(false);
    expect(matchesTitle('Senior PHP Developer', config)).toBe(false);
    expect(matchesTitle('Accountant', config)).toBe(false);
  });

  it('does not let excluded words match inside larger words', () => {
    expect(matchesTitle('International React Engineer', config)).toBe(true);
    expect(matchesTitle('React Intern', config)).toBe(false);
  });
});

describe('matchesLocation', () => {
  it('accepts Berlin regardless of work mode', () => {
    expect(matchesLocation(posting({ location: 'Berlin', workMode: 'onsite' }))).toBe(true);
  });

  it('accepts EU-wide remote, rejects non-EU remote', () => {
    expect(matchesLocation(posting({ location: 'Remote, Europe', workMode: 'remote' }))).toBe(true);
    expect(matchesLocation(posting({ location: '', workMode: 'remote' }))).toBe(true);
    expect(matchesLocation(posting({ location: 'New York, USA', workMode: 'remote' }))).toBe(false);
  });

  it('accepts hybrid only in Germany', () => {
    expect(matchesLocation(posting({ location: 'Munich, Germany', workMode: 'hybrid' }))).toBe(true);
    expect(matchesLocation(posting({ location: 'Paris, France', workMode: 'hybrid' }))).toBe(false);
  });

  it('rejects onsite outside Berlin, keeps unknown mode in Germany', () => {
    expect(matchesLocation(posting({ location: 'Hamburg', workMode: 'onsite' }))).toBe(false);
    expect(matchesLocation(posting({ location: 'Hamburg', workMode: 'unknown' }))).toBe(true);
    expect(matchesLocation(posting({ location: 'Madrid', workMode: 'unknown' }))).toBe(false);
  });

  it('rejects explicitly non-EU remote locations', () => {
    expect(matchesLocation(posting({ location: 'Remote, USA', workMode: 'remote' }))).toBe(false);
    expect(matchesLocation(posting({ location: 'Remote - North America', workMode: 'remote' }))).toBe(false);
    expect(matchesLocation(posting({ location: 'Berlin or New York, USA', workMode: 'onsite' }))).toBe(true);
  });
});

describe('detectGerman', () => {
  it('flags German text and passes English text', () => {
    const de =
      'Wir suchen eine erfahrene Person für unser Team. Deine Aufgaben sind vielfältig und wir bieten dir flexible Arbeitszeiten. Erfahrung mit React und gute Kenntnisse sind wichtig. Du arbeitest mit der besten Technologie und die Kollegen sind nett.';
    const en = 'We are looking for an experienced engineer to join our team building React applications.';
    expect(detectGerman(de)).toBe(true);
    expect(detectGerman(en)).toBe(false);
  });
});

describe('hardFilter', () => {
  it('keeps matching postings and flags German ones', () => {
    const good = posting({ id: 'x:good' });
    const wrongTitle = posting({ id: 'x:title', title: 'Sales Manager' });
    const wrongLoc = posting({ id: 'x:loc', location: 'Boston, USA', workMode: 'onsite' });
    const german = posting({
      id: 'x:de',
      description:
        'Wir suchen für unser Team eine erfahrene Person. Deine Aufgaben und deine Erfahrung mit React sind wichtig, gute Kenntnisse und die Arbeit mit der Plattform.',
    });
    const { kept, flaggedDe } = hardFilter([good, wrongTitle, wrongLoc, german], config);
    expect(kept.map((p) => p.id)).toEqual(['x:good', 'x:de']);
    expect(flaggedDe.has('x:de')).toBe(true);
    expect(flaggedDe.has('x:good')).toBe(false);
  });
});
