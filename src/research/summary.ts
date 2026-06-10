import type { CompaniesFile } from './companies-file';

export interface CompaniesDiff {
  added: string[];
  dropped: string[];
}

export function diffCompanies(previous: CompaniesFile, current: CompaniesFile): CompaniesDiff {
  const prevNames = new Set(previous.companies.map((c) => c.name.toLowerCase()));
  const currNames = new Set(current.companies.map((c) => c.name.toLowerCase()));
  return {
    added: current.companies.filter((c) => !prevNames.has(c.name.toLowerCase())).map((c) => c.name),
    dropped: previous.companies.filter((c) => !currNames.has(c.name.toLowerCase())).map((c) => c.name),
  };
}

export function formatCompaniesMessage(current: CompaniesFile, diff: CompaniesDiff): string {
  const lines = [`🏆 Top-paying companies updated — ${current.companies.length} companies`];
  current.companies.forEach((c, i) => {
    const board = c.board ? `${c.board.vendor}:${c.board.slug}` : 'no board found';
    lines.push(`${i + 1}. ${c.name} — ~€${Math.round(c.estSeniorTotalCompEur / 1000)}k (${c.germanyPresence}, ${board})`);
  });
  if (diff.added.length > 0) lines.push(`➕ New: ${diff.added.join(', ')}`);
  if (diff.dropped.length > 0) lines.push(`➖ Dropped: ${diff.dropped.join(', ')}`);
  const noBoard = current.companies.filter((c) => !c.board).length;
  if (noBoard > 0) lines.push(`⚠️ ${noBoard} without a discoverable job board (covered by broad searches only)`);
  return lines.join('\n');
}
