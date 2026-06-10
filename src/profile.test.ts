import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProfile } from './profile';

describe('loadProfile', () => {
  it('extracts and normalizes text from a PDF', async () => {
    const profile = await loadProfile('fixtures/profile.pdf');
    expect(profile).toContain('PROFILE FIXTURE Senior Frontend Engineer');
    expect(profile).toContain('React, TypeScript, Node');
    expect(profile.length).toBeGreaterThanOrEqual(200);
    expect(profile).not.toMatch(/[^\S\n]{2,}/); // no runs of horizontal whitespace
  });

  it('rejects when the file does not exist', async () => {
    await expect(loadProfile(join(tmpdir(), 'does-not-exist.pdf'))).rejects.toThrow(/not found/);
  });

  it('rejects a PDF without a text layer', async () => {
    await expect(loadProfile('fixtures/profile-scanned.pdf')).rejects.toThrow(/no text layer/);
  });
});
