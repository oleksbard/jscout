import type { JobPosting } from '../types';
import { stripHtml } from '../util';

export interface ArbeitnowResponse {
  data: {
    slug: string;
    company_name: string;
    title: string;
    description: string;
    remote: boolean;
    url: string;
    location: string;
    created_at: number;
  }[];
}

export function normalizeArbeitnow(payload: ArbeitnowResponse): JobPosting[] {
  return payload.data.map((j) => ({
    id: `arbeitnow:${j.slug}`,
    source: 'arbeitnow',
    url: j.url,
    title: j.title,
    company: j.company_name,
    location: j.location ?? '',
    workMode: j.remote ? ('remote' as const) : ('unknown' as const),
    description: stripHtml(j.description ?? ''),
    postedAt: new Date(j.created_at * 1000).toISOString(),
  }));
}

export async function fetchArbeitnow(): Promise<JobPosting[]> {
  const res = await fetch('https://www.arbeitnow.com/api/job-board-api');
  if (!res.ok) throw new Error(`arbeitnow: HTTP ${res.status}`);
  return normalizeArbeitnow((await res.json()) as ArbeitnowResponse);
}
