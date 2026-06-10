import { describe, expect, it } from 'vitest';
import type { Config } from '../config';
import type { JobPosting } from '../types';
import { detectGerman, hardFilter, matchesLocation, matchesTitle, meetsSalaryFloor } from './filter';

const config = {
  titleInclude: ['frontend', 'react', 'engineering manager'],
  titleExclude: ['intern', 'php'],
  minSalaryEur: 0,
} as Pick<Config, 'titleInclude' | 'titleExclude' | 'minSalaryEur'> as Config;

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
  it('drops onsite everywhere, including Berlin', () => {
    expect(matchesLocation(posting({ location: 'Berlin', workMode: 'onsite' }))).toBe(false);
    expect(matchesLocation(posting({ location: 'Hamburg', workMode: 'onsite' }))).toBe(false);
  });

  it('accepts EU-wide remote, rejects clearly non-EU remote', () => {
    expect(matchesLocation(posting({ location: 'Remote, Europe', workMode: 'remote' }))).toBe(true);
    expect(matchesLocation(posting({ location: '', workMode: 'remote' }))).toBe(true);
    expect(matchesLocation(posting({ location: 'New York, USA', workMode: 'remote' }))).toBe(false);
    expect(matchesLocation(posting({ location: 'Remote, Singapore', workMode: 'remote' }))).toBe(false);
    expect(matchesLocation(posting({ location: 'Remote, Switzerland', workMode: 'remote' }))).toBe(false);
  });

  it('accepts hybrid only in Berlin', () => {
    expect(matchesLocation(posting({ location: 'Berlin, Germany', workMode: 'hybrid' }))).toBe(true);
    expect(matchesLocation(posting({ location: 'Munich, Germany', workMode: 'hybrid' }))).toBe(false);
    expect(matchesLocation(posting({ location: 'Berlin or New York, USA', workMode: 'hybrid' }))).toBe(true);
  });

  it('keeps unknown work mode only in Berlin', () => {
    expect(matchesLocation(posting({ location: 'Berlin', workMode: 'unknown' }))).toBe(true);
    expect(matchesLocation(posting({ location: 'Hamburg', workMode: 'unknown' }))).toBe(false);
    expect(matchesLocation(posting({ location: 'Madrid', workMode: 'unknown' }))).toBe(false);
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

describe('meetsSalaryFloor', () => {
  it('passes when no salary stated or no floor configured', () => {
    expect(meetsSalaryFloor(undefined, 100000)).toBe(true);
    expect(meetsSalaryFloor('75000–90000', 0)).toBe(true);
  });

  it('compares the max of the stated range against the floor', () => {
    expect(meetsSalaryFloor('75000–90000', 100000)).toBe(false);
    expect(meetsSalaryFloor('95000–120000', 100000)).toBe(true);
  });

  it('passes non-numeric salary strings through', () => {
    expect(meetsSalaryFloor('competitive', 100000)).toBe(true);
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

  it('drops postings below the salary floor when configured', () => {
    const cheap = posting({ id: 'x:cheap', salary: '60000–80000' });
    const rich = posting({ id: 'x:rich', salary: '90000–130000' });
    const { kept } = hardFilter([cheap, rich], { ...config, minSalaryEur: 100000 });
    expect(kept.map((p) => p.id)).toEqual(['x:rich']);
  });
});
