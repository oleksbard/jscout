import { readFileSync } from 'node:fs';

export interface Config {
  thresholds: { hot: number; digest: number };
  maxJobsScoredPerRun: number;
  scoringConcurrency: number;
  tailor: boolean;
  models: { scoring: string; tailoring: string };
  searchTerms: string[];
  titleInclude: string[];
  titleExclude: string[];
  watchlist: { greenhouse: string[]; lever: string[]; personio: string[] };
  sources: Record<string, boolean>;
}

export function loadConfig(path = 'config.json'): Config {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Config>;
  return {
    thresholds: { hot: 80, digest: 60, ...raw.thresholds },
    maxJobsScoredPerRun: raw.maxJobsScoredPerRun ?? 100,
    scoringConcurrency: raw.scoringConcurrency ?? 5,
    tailor: raw.tailor ?? true,
    // Model ids are config-only — verify current OpenAI model names/pricing before first real run.
    models: { scoring: 'gpt-5-mini', tailoring: 'gpt-5', ...raw.models },
    searchTerms: raw.searchTerms ?? [],
    titleInclude: raw.titleInclude ?? [],
    titleExclude: raw.titleExclude ?? [],
    watchlist: { greenhouse: [], lever: [], personio: [], ...raw.watchlist },
    sources: raw.sources ?? {},
  };
}
