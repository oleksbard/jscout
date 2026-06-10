import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

function writeTmpConfig(json: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'job-scout-'));
  const path = join(dir, 'config.json');
  writeFileSync(path, JSON.stringify(json));
  return path;
}

describe('loadConfig', () => {
  it('applies defaults for missing fields', () => {
    const config = loadConfig(writeTmpConfig({}));
    expect(config.thresholds).toEqual({ hot: 80, digest: 60 });
    expect(config.maxJobsScoredPerRun).toBe(100);
    expect(config.models.scoring).toBeTruthy();
    expect(config.watchlist).toEqual({ greenhouse: [], lever: [], personio: [] });
    expect(config.tailor).toBe(true);
    expect(config.scoringConcurrency).toBe(5);
    expect(config.minSalaryEur).toBe(0);
    expect(config.models.research).toBe('gpt-5');
    expect(config.topCompanies).toEqual({ count: 30 });
  });

  it('keeps explicit values', () => {
    const config = loadConfig(
      writeTmpConfig({ thresholds: { hot: 90, digest: 70 }, maxJobsScoredPerRun: 10, tailor: false, scoringConcurrency: 2, minSalaryEur: 100000, topCompanies: { count: 10 } }),
    );
    expect(config.thresholds).toEqual({ hot: 90, digest: 70 });
    expect(config.maxJobsScoredPerRun).toBe(10);
    expect(config.tailor).toBe(false);
    expect(config.scoringConcurrency).toBe(2);
    expect(config.minSalaryEur).toBe(100000);
    expect(config.topCompanies).toEqual({ count: 10 });
  });
});
