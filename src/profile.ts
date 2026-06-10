import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extractText, getDocumentProxy } from 'unpdf';

const MIN_PROFILE_CHARS = 200;

export async function loadProfile(path = 'profile.pdf'): Promise<string> {
  if (!existsSync(path)) {
    throw new Error(`profile: ${path} not found — export your CV as profile.pdf`);
  }
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(path)));
  const { text } = await extractText(pdf, { mergePages: true });
  // Collapse horizontal whitespace runs but keep line structure for prompt readability.
  const profile = text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (profile.length < MIN_PROFILE_CHARS) {
    throw new Error(`profile: no text layer found in ${path} (scanned PDF?)`);
  }
  return profile;
}
