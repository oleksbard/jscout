import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const MIN_PROFILE_CHARS = 200;

export async function loadProfile(path = 'profile.md'): Promise<string> {
  if (!existsSync(path)) {
    throw new Error(`profile: ${path} not found — write your CV content (minus contact details) as profile.md`);
  }
  const profile = (await readFile(path, 'utf8')).trim();
  if (profile.length < MIN_PROFILE_CHARS) {
    throw new Error(`profile: ${path} is too short (<${MIN_PROFILE_CHARS} chars) — fill in your CV content`);
  }
  return profile;
}
