import type { Config } from '../config';
import type { JobPosting } from '../types';
import { stripHtml } from '../util';
import { inferWorkMode } from './adzuna';

export interface GreenhouseResponse {
  jobs: { id: number; title: string; absolute_url: string; location: { name: string }; content: string; updated_at: string }[];
}

export function normalizeGreenhouse(slug: string, payload: GreenhouseResponse): JobPosting[] {
  return payload.jobs.map((j) => {
    const description = stripHtml(
      j.content.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
    );
    return {
      id: `greenhouse:${slug}:${j.id}`,
      source: 'greenhouse',
      url: j.absolute_url,
      title: j.title,
      company: slug,
      location: j.location.name,
      workMode: inferWorkMode(`${j.location.name} ${description}`),
      description,
      postedAt: new Date(j.updated_at).toISOString(),
    };
  });
}

export type LeverResponse = {
  id: string;
  text: string;
  hostedUrl: string;
  categories: { location?: string; commitment?: string };
  descriptionPlain: string;
  createdAt: number;
}[];

export function normalizeLever(slug: string, payload: LeverResponse): JobPosting[] {
  return payload.map((j) => ({
    id: `lever:${slug}:${j.id}`,
    source: 'lever',
    url: j.hostedUrl,
    title: j.text,
    company: slug,
    location: j.categories.location ?? '',
    workMode: inferWorkMode(`${j.categories.location ?? ''} ${j.descriptionPlain}`),
    description: j.descriptionPlain,
    postedAt: new Date(j.createdAt).toISOString(),
  }));
}

export type PersonioResponse = {
  id: number;
  name: string;
  office?: string;
  descriptions?: { name: string; value: string }[];
}[];

export function normalizePersonio(slug: string, payload: PersonioResponse): JobPosting[] {
  return payload.map((j) => {
    const description = stripHtml((j.descriptions ?? []).map((d) => d.value).join(' '));
    return {
      id: `personio:${slug}:${j.id}`,
      source: 'personio',
      url: `https://${slug}.jobs.personio.de/job/${j.id}`,
      title: j.name,
      company: slug,
      location: j.office ?? '',
      workMode: inferWorkMode(`${j.office ?? ''} ${description}`),
      description,
      postedAt: new Date(0).toISOString(), // personio search.json has no posting date
    };
  });
}

export async function fetchWatchlist(config: Config): Promise<JobPosting[]> {
  const tasks: { label: string; fn: () => Promise<JobPosting[]> }[] = [
    ...config.watchlist.greenhouse.map((slug) => ({
      label: `greenhouse ${slug}`,
      fn: async () => {
        const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
        if (!res.ok) throw new Error(`greenhouse ${slug}: HTTP ${res.status}`);
        return normalizeGreenhouse(slug, (await res.json()) as GreenhouseResponse);
      },
    })),
    ...config.watchlist.lever.map((slug) => ({
      label: `lever ${slug}`,
      fn: async () => {
        const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`);
        if (!res.ok) throw new Error(`lever ${slug}: HTTP ${res.status}`);
        return normalizeLever(slug, (await res.json()) as LeverResponse);
      },
    })),
    ...config.watchlist.personio.map((slug) => ({
      label: `personio ${slug}`,
      fn: async () => {
        const res = await fetch(`https://${slug}.jobs.personio.de/search.json`);
        if (!res.ok) throw new Error(`personio ${slug}: HTTP ${res.status}`);
        return normalizePersonio(slug, (await res.json()) as PersonioResponse);
      },
    })),
  ];

  const all: JobPosting[] = [];
  const errors: string[] = [];
  for (const task of tasks) {
    try {
      all.push(...(await task.fn()));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(message);
      console.warn(`watchlist: ${task.label} skipped — ${message}`);
    }
  }
  // Only a total wipe-out counts as a source failure; partial results are fine.
  if (tasks.length > 0 && errors.length === tasks.length) {
    throw new Error(`watchlist: all companies failed (${errors.join('; ')})`);
  }
  return all;
}
