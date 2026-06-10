import { readFileSync } from 'node:fs';
import type { JobPosting, ScoreResult } from './types';
import { normalizeAdzuna, type AdzunaResponse } from './sources/adzuna';
import { normalizeArbeitnow, type ArbeitnowResponse } from './sources/arbeitnow';
import { normalizeHnComments, type HnCommentsResponse } from './sources/hn-whoishiring';
import { normalizeJsearch, type JsearchResponse } from './sources/jsearch';
import { normalizeRemoteok } from './sources/remoteok';
import {
  normalizeGreenhouse, normalizeLever, normalizePersonio,
  type GreenhouseResponse, type LeverResponse, type PersonioResponse,
} from './sources/watchlist';
import { TopCompaniesSchema, type ResearchedCompany } from './research/top-companies';

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(`fixtures/${name}.json`, 'utf8')) as T;
}

export function loadFixturePostings(): JobPosting[] {
  return [
    ...normalizeArbeitnow(fixture<ArbeitnowResponse>('arbeitnow')),
    ...normalizeRemoteok(fixture<unknown[]>('remoteok')),
    ...normalizeAdzuna(fixture<AdzunaResponse>('adzuna')),
    ...normalizeJsearch(fixture<JsearchResponse>('jsearch')),
    ...normalizeHnComments(fixture<HnCommentsResponse>('hn-comments')),
    ...normalizeGreenhouse('acme', fixture<GreenhouseResponse>('greenhouse')),
    ...normalizeLever('acme', fixture<LeverResponse>('lever')),
    ...normalizePersonio('acme', fixture<PersonioResponse>('personio')),
  ];
}

export function fakeScore(posting: JobPosting): ScoreResult {
  // Deterministic pseudo-score from the id so dry-run output is stable.
  let hash = 0;
  for (const ch of posting.id) hash = (hash * 31 + ch.charCodeAt(0)) % 101;
  return {
    score: hash,
    stackFit: hash,
    seniorityFit: hash,
    locationFit: hash,
    reasoning: `dry-run fake score for ${posting.id}`,
    language: 'en',
  };
}

export function loadFixtureCompanies(): ResearchedCompany[] {
  // Schema-parse so the fixture is validated against the live schema.
  return TopCompaniesSchema.parse(fixture('top-companies')).companies;
}
