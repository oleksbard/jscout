import type { Config } from '../config';
import type { JobPosting } from '../types';

const GERMANY_HINTS = [
  'germany', 'deutschland', 'berlin', 'munich', 'münchen', 'hamburg', 'cologne', 'köln', 'frankfurt',
  'stuttgart', 'düsseldorf', 'leipzig', 'dresden', 'bremen', 'hannover', 'nuremberg', 'nürnberg', 'karlsruhe',
];

const EU_HINTS = [
  ...GERMANY_HINTS,
  'austria', 'netherlands', 'poland', 'france', 'spain', 'portugal', 'italy', 'ireland', 'belgium',
  'denmark', 'sweden', 'finland', 'czech', 'estonia', 'latvia', 'lithuania', 'greece', 'romania',
  'bulgaria', 'croatia', 'hungary', 'slovakia', 'slovenia', 'luxembourg', 'europe', ' eu', 'emea', 'remote',
];

const NON_EU_HINTS = [
  ' usa', 'united states', 'u.s.', 'north america', 'latin america',
  'canada', 'united kingdom', 'australia', 'new zealand', 'india',
];

function hasWord(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(text);
}

export function matchesTitle(title: string, config: Config): boolean {
  const t = title.toLowerCase();
  if (config.titleExclude.some((k) => hasWord(t, k))) return false;
  return config.titleInclude.some((k) => t.includes(k));
}

export function matchesLocation(p: JobPosting): boolean {
  const loc = ` ${p.location.toLowerCase()} `;
  const inGermany = GERMANY_HINTS.some((h) => loc.includes(h));
  const inEu = p.location === '' || EU_HINTS.some((h) => loc.includes(h));
  if (loc.includes('berlin')) return true; // Berlin: any work mode
  if (NON_EU_HINTS.some((h) => loc.includes(h))) return false; // explicitly non-EU: drop
  if (p.workMode === 'remote') return inEu; // remote: EU-wide
  if (p.workMode === 'hybrid') return inGermany; // hybrid: Germany only
  if (p.workMode === 'onsite') return false; // onsite outside Berlin: drop
  return inGermany; // unknown mode: keep German postings, scorer judges the rest
}

const GERMAN_MARKERS = [
  ' und ', ' der ', ' die ', ' das ', ' für ', ' mit ', ' wir ', ' du ', ' deine ', ' nicht ',
  ' erfahrung', ' kenntnisse', ' aufgaben', ' arbeit', ' team ', ' suchen ',
];

export function detectGerman(text: string): boolean {
  const sample = ` ${text.toLowerCase().slice(0, 2000)} `;
  const hits = GERMAN_MARKERS.filter((m) => sample.includes(m)).length;
  return hits >= 5;
}

export function hardFilter(
  postings: JobPosting[],
  config: Config,
): { kept: JobPosting[]; flaggedDe: Set<string> } {
  const kept = postings.filter((p) => matchesTitle(p.title, config) && matchesLocation(p));
  const flaggedDe = new Set(kept.filter((p) => detectGerman(p.description)).map((p) => p.id));
  return { kept, flaggedDe };
}
