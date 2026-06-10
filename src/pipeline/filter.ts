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
  'switzerland', 'singapore', 'japan', 'china', 'uae', 'dubai', 'israel',
  'brazil', 'mexico', 'asia', 'apac', 'africa', 'middle east',
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
  const inBerlin = loc.includes('berlin');
  // Clearly non-EU — unless Berlin is one of the listed offices (multi-office postings).
  if (!inBerlin && NON_EU_HINTS.some((h) => loc.includes(h))) return false;
  const inEu = p.location === '' || EU_HINTS.some((h) => loc.includes(h));
  if (p.workMode === 'onsite') return false; // onsite: never, anywhere
  if (p.workMode === 'remote') return inEu; // remote: EU-wide
  if (p.workMode === 'hybrid') return inBerlin; // hybrid: Berlin only
  return inBerlin; // unknown mode: Berlin only — elsewhere it's almost certainly a local role
}

export function meetsSalaryFloor(salary: string | undefined, floorEur: number): boolean {
  if (!salary || floorEur <= 0) return true;
  const numbers = (salary.match(/\d+(?:[.,]\d+)*/g) ?? [])
    .map((raw) => Number(raw.replace(/[.,](?=\d{3}(?:\D|$))/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (numbers.length === 0) return true;
  const max = Math.max(...numbers);
  return (max < 1000 ? max * 1000 : max) >= floorEur; // "75–90" style means thousands
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
  const kept = postings.filter(
    (p) => matchesTitle(p.title, config) && matchesLocation(p) && meetsSalaryFloor(p.salary, config.minSalaryEur),
  );
  const flaggedDe = new Set(kept.filter((p) => detectGerman(p.description)).map((p) => p.id));
  return { kept, flaggedDe };
}
