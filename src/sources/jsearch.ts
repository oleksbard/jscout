import type { Config } from '../config';
import type { JobPosting } from '../types';
import { stripHtml } from '../util';
import { inferWorkMode } from './adzuna';

export interface JsearchResponse {
  data: {
    job_id: string;
    employer_name: string | null;
    job_title: string;
    job_description: string;
    job_apply_link: string;
    job_city: string | null;
    job_country: string | null;
    job_is_remote: boolean;
    job_posted_at_datetime_utc: string | null;
  }[];
}

export function normalizeJsearch(payload: JsearchResponse): JobPosting[] {
  return payload.data.map((j) => ({
    id: `jsearch:${j.job_id}`,
    source: 'jsearch',
    url: j.job_apply_link,
    title: j.job_title,
    company: j.employer_name ?? '',
    location: [j.job_city, j.job_country].filter(Boolean).join(', '),
    workMode: j.job_is_remote ? ('remote' as const) : inferWorkMode(j.job_description),
    description: stripHtml(j.job_description),
    postedAt: j.job_posted_at_datetime_utc ?? new Date(0).toISOString(),
  }));
}

export async function fetchJsearch(config: Config): Promise<JobPosting[]> {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) throw new Error('jsearch: RAPIDAPI_KEY not set');
  const all: JobPosting[] = [];
  for (const term of config.searchTerms) {
    const url = new URL('https://jsearch.p.rapidapi.com/search');
    url.searchParams.set('query', `${term} in Germany`);
    url.searchParams.set('date_posted', 'today');
    url.searchParams.set('num_pages', '1');
    const res = await fetch(url, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' },
    });
    if (!res.ok) throw new Error(`jsearch: HTTP ${res.status} for "${term}"`);
    all.push(...normalizeJsearch((await res.json()) as JsearchResponse));
  }
  return all;
}
