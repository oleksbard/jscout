import type { JobPosting, State } from '../types';

const TITLE_NOISE = /\((?:m\/w\/d|f\/m\/d|w\/m\/d|m\/f\/d|d\/f\/m|all genders?)\)/gi;
const COMPANY_SUFFIXES = /\b(gmbh|ag|se|inc|ltd|llc|ug|kg|co|corp|company)\b/gi;

function normalize(text: string, extra?: RegExp): string {
  let t = text.toLowerCase().replace(TITLE_NOISE, '');
  if (extra) t = t.replace(extra, ' ');
  return t
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function fuzzyKey(posting: Pick<JobPosting, 'company' | 'title'>): string {
  // Sources occasionally emit postings with missing fields despite the types;
  // one malformed posting must not crash the whole run.
  const company = normalize((posting.company ?? '').replace(COMPANY_SUFFIXES, ' '));
  const title = normalize(posting.title ?? '');
  return `${company}|${title}`;
}

export function dedupe(postings: JobPosting[], state: State): JobPosting[] {
  const knownIds = new Set(Object.keys(state.jobs));
  const knownKeys = new Set(Object.values(state.jobs).map((j) => j.fuzzyKey));
  const result: JobPosting[] = [];
  for (const p of postings) {
    const key = fuzzyKey(p);
    if (knownIds.has(p.id) || knownKeys.has(key)) continue;
    knownIds.add(p.id);
    knownKeys.add(key);
    result.push(p);
  }
  return result;
}
