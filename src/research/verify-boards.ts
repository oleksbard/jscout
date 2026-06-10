import { mapWithConcurrency } from '../util';
import type { BoardVendor, CompaniesFile, CompanyBoard, CompanyEntry } from './companies-file';
import type { ResearchedCompany } from './top-companies';

function foldAscii(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

// Candidate slugs: LLM guesses first (most likely), then name-derived forms. Capped at 6.
export function slugVariants(name: string, guesses: string[]): string[] {
  const ascii = foldAscii(name);
  const collapsed = ascii.replace(/[^a-z0-9]/g, '');
  const dashed = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const all = [...guesses.map((g) => g.trim().toLowerCase()), collapsed, dashed];
  const valid = all.filter((v) => /^[a-z0-9][a-z0-9-]*$/.test(v));
  return [...new Set(valid)].slice(0, 6);
}

// Guards against slug collisions: the board must plausibly belong to the company.
export function namesMatch(boardName: string, companyName: string): boolean {
  const a = foldAscii(boardName).replace(/[^a-z0-9]/g, '');
  const b = foldAscii(companyName).replace(/[^a-z0-9]/g, '');
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
}

export type ProbeResult = 'hit' | 'miss' | 'error';
export type ProbeFn = (vendor: BoardVendor, slug: string, company: string) => Promise<ProbeResult>;

async function probeGreenhouse(slug: string, company: string): Promise<boolean> {
  const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}`);
  if (!res.ok) return false;
  const body = (await res.json()) as { name?: string };
  return namesMatch(body.name ?? '', company);
}

async function probeLever(slug: string): Promise<boolean> {
  const res = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json&limit=1`);
  if (!res.ok) return false;
  return Array.isArray(await res.json());
}

async function probePersonio(slug: string): Promise<boolean> {
  const res = await fetch(`https://${slug}.jobs.personio.de/search.json`);
  return res.ok;
}

// 'error' (thrown fetch, e.g. DNS/network) is tracked separately from a clean 'miss'
// so a total network wipe-out can fail the run instead of silently emptying the list.
export const defaultProbe: ProbeFn = async (vendor, slug, company) => {
  try {
    if (vendor === 'greenhouse') return (await probeGreenhouse(slug, company)) ? 'hit' : 'miss';
    if (vendor === 'lever') return (await probeLever(slug)) ? 'hit' : 'miss';
    return (await probePersonio(slug)) ? 'hit' : 'miss';
  } catch {
    return 'error';
  }
};

export function buildBoardCache(previous: CompaniesFile): Record<string, CompanyBoard> {
  // Null prototype: a company named "Constructor" must not hit Object.prototype.
  const cache: Record<string, CompanyBoard> = Object.create(null);
  for (const c of previous.companies) {
    if (c.board) cache[c.name.toLowerCase()] = c.board;
  }
  return cache;
}

const VENDORS: BoardVendor[] = ['greenhouse', 'lever', 'personio'];

export async function discoverBoards(
  companies: ResearchedCompany[],
  cache: Record<string, CompanyBoard>,
  probe: ProbeFn = defaultProbe,
): Promise<CompanyEntry[]> {
  let hits = 0;
  let misses = 0;
  let errors = 0;
  const entries = await mapWithConcurrency(companies, 5, async (c): Promise<CompanyEntry> => {
    const base = {
      name: c.name,
      reason: c.reason,
      estSeniorTotalCompEur: c.estSeniorTotalCompEur,
      germanyPresence: c.germanyPresence,
    };
    const cached = cache[c.name.toLowerCase()];
    if (cached) return { ...base, board: cached };
    const slugs = slugVariants(c.name, c.ats.slugGuesses);
    const claimed = VENDORS.find((v) => v === c.ats.vendor);
    const vendors = claimed ? [claimed, ...VENDORS.filter((v) => v !== claimed)] : VENDORS;
    for (const vendor of vendors) {
      for (const slug of slugs) {
        const result = await probe(vendor, slug, c.name);
        if (result === 'hit') {
          hits += 1;
          return { ...base, board: { vendor, slug } };
        }
        if (result === 'miss') misses += 1;
        else errors += 1;
      }
    }
    return { ...base, board: null };
  });
  if (errors > 0 && hits === 0 && misses === 0) {
    throw new Error(`board discovery: all ${errors} probes errored (network?)`);
  }
  return entries;
}
