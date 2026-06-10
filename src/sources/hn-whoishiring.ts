import type { JobPosting } from '../types';
import { stripHtml } from '../util';

export interface HnCommentsResponse {
  hits: { objectID: string; comment_text: string | null; created_at: string }[];
}

interface HnStoriesResponse {
  hits: { objectID: string; title: string }[];
}

export function normalizeHnComments(payload: HnCommentsResponse): JobPosting[] {
  const jobs: JobPosting[] = [];
  for (const hit of payload.hits) {
    const text = stripHtml(hit.comment_text ?? '');
    if (text.length < 80) continue; // replies / noise, not postings
    const headline = text.split(/(?<=^[^.]{0,200})\s{2,}|(?=Apply|http)/)[0] ?? text;
    const parts = headline.split('|').map((s) => s.trim());
    if (parts.length < 2) continue; // postings follow "Company | Role | Location | ..."
    const [company, title, location = ''] = parts;
    jobs.push({
      id: `hn:${hit.objectID}`,
      source: 'hn',
      url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      title: title ?? '',
      company: company ?? '',
      location,
      workMode: /\b(?:no|not|non-?)\s*remote\b/i.test(text)
        ? 'unknown'
        : /remote/i.test(text)
          ? 'remote'
          : 'unknown',
      description: text.slice(0, 4000),
      postedAt: new Date(hit.created_at).toISOString(),
    });
  }
  return jobs;
}

export async function fetchHnWhoIsHiring(): Promise<JobPosting[]> {
  const storiesRes = await fetch(
    'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=who%20is%20hiring',
  );
  if (!storiesRes.ok) throw new Error(`hn stories: HTTP ${storiesRes.status}`);
  const stories = (await storiesRes.json()) as HnStoriesResponse;
  const latest = stories.hits.find((h) => /who is hiring/i.test(h.title));
  if (!latest) return [];
  const commentsRes = await fetch(
    `https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_${latest.objectID}&hitsPerPage=300`,
  );
  if (!commentsRes.ok) throw new Error(`hn comments: HTTP ${commentsRes.status}`);
  return normalizeHnComments((await commentsRes.json()) as HnCommentsResponse);
}
