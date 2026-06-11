import type { JobPosting } from '../types';
import { stripHtml } from '../util';

interface RemoteokJob {
  id: string | number;
  company?: string;
  position: string;
  description: string;
  location: string;
  url: string;
  date: string;
}

function isJob(entry: unknown): entry is RemoteokJob {
  return typeof entry === 'object' && entry !== null && 'position' in entry;
}

export function normalizeRemoteok(payload: unknown[]): JobPosting[] {
  return payload.filter(isJob).map((j) => ({
    id: `remoteok:${j.id}`,
    source: 'remoteok',
    url: j.url,
    title: j.position,
    company: j.company ?? '',
    location: j.location ?? '',
    workMode: 'remote' as const, // RemoteOK lists remote jobs only
    description: stripHtml(j.description ?? ''),
    postedAt: new Date(j.date).toISOString(),
  }));
}

export async function fetchRemoteok(): Promise<JobPosting[]> {
  const res = await fetch('https://remoteok.com/api', {
    headers: { 'user-agent': 'job-scout (personal job search)' },
  });
  if (!res.ok) throw new Error(`remoteok: HTTP ${res.status}`);
  return normalizeRemoteok((await res.json()) as unknown[]);
}
