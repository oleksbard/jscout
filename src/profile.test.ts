import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProfile } from './profile';

function tmpProfile(content: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'jscout-profile-')), 'profile.md');
  writeFileSync(path, content);
  return path;
}

describe('loadProfile', () => {
  it('loads and trims a markdown profile', async () => {
    const body = `# Candidate profile\n\nSenior Frontend Engineer. ${'Experience detail. '.repeat(20)}\n\n`;
    const profile = await loadProfile(tmpProfile(body));
    expect(profile).toContain('Senior Frontend Engineer');
    expect(profile).toBe(body.trim());
  });

  it('rejects when the file does not exist', async () => {
    await expect(loadProfile(join(tmpdir(), 'does-not-exist.md'))).rejects.toThrow(/not found/);
  });

  it('rejects a near-empty profile', async () => {
    await expect(loadProfile(tmpProfile('# todo\n'))).rejects.toThrow(/too short/);
  });
});
