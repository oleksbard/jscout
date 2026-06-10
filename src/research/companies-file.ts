import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const COMPANIES_PATH = 'state/companies.json';

export type BoardVendor = 'greenhouse' | 'lever' | 'personio';

export interface CompanyBoard {
  vendor: BoardVendor;
  slug: string;
}

export interface CompanyEntry {
  name: string;
  reason: string;
  estSeniorTotalCompEur: number;
  germanyPresence: 'office' | 'remote-eu';
  board: CompanyBoard | null;
}

export interface CompaniesFile {
  updatedAt: string;
  companies: CompanyEntry[];
}

export function emptyCompaniesFile(): CompaniesFile {
  return { updatedAt: new Date(0).toISOString(), companies: [] };
}

export function loadCompaniesFile(path: string): CompaniesFile {
  if (!existsSync(path)) return emptyCompaniesFile();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<CompaniesFile>;
    if (!Array.isArray(parsed.companies)) throw new Error('companies is not an array');
    return { ...emptyCompaniesFile(), ...parsed };
  } catch (err) {
    // A corrupt generated artifact must never take down the consumers that
    // treat it as an optional extension (watchlist) — degrade to empty.
    console.warn(`companies file ${path} unreadable, ignoring:`, err instanceof Error ? err.message : err);
    return emptyCompaniesFile();
  }
}

export function saveCompaniesFile(path: string, file: CompaniesFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2) + '\n');
}
