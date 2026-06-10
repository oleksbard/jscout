import type { Config } from '../config';
import type { JobPosting, WorkMode } from '../types';
import { stripHtml } from '../util';

export interface AdzunaResponse {
  results: {
    id: string;
    title: string;
    company: { display_name: string };
    location: { display_name: string };
    description: string;
    redirect_url: string;
    created: string;
    salary_min?: number;
    salary_max?: number;
  }[];
}

export function inferWorkMode(text: string): WorkMode {
  const t = text.toLowerCase();
  if (/\b(hybrid)\b/.test(t)) return 'hybrid';
  if (/\b(remote|home\s?office)\b/.test(t)) return 'remote';
  if (/\b(on-?site|vor ort)\b/.test(t)) return 'onsite';
  return 'unknown';
}

export function normalizeAdzuna(payload: AdzunaResponse): JobPosting[] {
  return payload.results.map((j) => ({
    id: `adzuna:${j.id}`,
    source: 'adzuna',
    url: j.redirect_url,
    title: j.title,
    company: j.company.display_name,
    location: j.location.display_name,
    workMode: inferWorkMode(`${j.title} ${j.description}`),
    description: stripHtml(j.description),
    postedAt: new Date(j.created).toISOString(),
    ...(j.salary_min != null && j.salary_max != null && j.salary_max > 0
      ? { salary: `${j.salary_min}–${j.salary_max}` }
      : {}),
  }));
}

export async function fetchAdzuna(config: Config): Promise<JobPosting[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) throw new Error('adzuna: ADZUNA_APP_ID / ADZUNA_APP_KEY not set');
  const all: JobPosting[] = [];
  for (const term of config.searchTerms) {
    const url = new URL('https://api.adzuna.com/v1/api/jobs/de/search/1');
    url.searchParams.set('app_id', appId);
    url.searchParams.set('app_key', appKey);
    url.searchParams.set('what', term);
    url.searchParams.set('results_per_page', '50');
    url.searchParams.set('max_days_old', '2');
    url.searchParams.set('content-type', 'application/json');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`adzuna: HTTP ${res.status} for "${term}"`);
    all.push(...normalizeAdzuna((await res.json()) as AdzunaResponse));
  }
  return all;
}
