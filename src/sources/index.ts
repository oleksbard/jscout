import type { Config } from '../config';
import type { JobPosting } from '../types';
import { fetchAdzuna } from './adzuna';
import { fetchArbeitnow } from './arbeitnow';
import { fetchHnWhoIsHiring } from './hn-whoishiring';
import { fetchJsearch } from './jsearch';
import { fetchRemoteok } from './remoteok';
import { fetchWatchlist } from './watchlist';

export interface SourceTask {
  name: string;
  fn: () => Promise<JobPosting[]>;
}

export interface SourceRunResult {
  postings: JobPosting[];
  failures: { source: string; error: string }[];
}

export function buildSourceTasks(config: Config, opts: { includeJsearch: boolean }): SourceTask[] {
  const tasks: SourceTask[] = [];
  if (config.sources.arbeitnow) tasks.push({ name: 'arbeitnow', fn: fetchArbeitnow });
  if (config.sources.remoteok) tasks.push({ name: 'remoteok', fn: fetchRemoteok });
  if (config.sources.adzuna) tasks.push({ name: 'adzuna', fn: () => fetchAdzuna(config) });
  // config key 'hnWhoIsHiring', task/state failure key 'hn'
  if (config.sources.hnWhoIsHiring) tasks.push({ name: 'hn', fn: fetchHnWhoIsHiring });
  if (config.sources.jsearch && opts.includeJsearch) tasks.push({ name: 'jsearch', fn: () => fetchJsearch(config) });
  if (config.sources.watchlist) tasks.push({ name: 'watchlist', fn: () => fetchWatchlist(config) });
  return tasks;
}

export async function runSources(tasks: SourceTask[]): Promise<SourceRunResult> {
  const settled = await Promise.allSettled(tasks.map((t) => t.fn()));
  const postings: JobPosting[] = [];
  const failures: { source: string; error: string }[] = [];
  settled.forEach((res, i) => {
    const name = tasks[i]!.name;
    if (res.status === 'fulfilled') postings.push(...res.value);
    else failures.push({ source: name, error: res.reason instanceof Error ? res.reason.message : String(res.reason) });
  });
  return { postings, failures };
}
