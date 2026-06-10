import OpenAI from 'openai';
import { loadConfig } from './config';
import { loadFixtureCompanies } from './dry-run';
import { sendTelegram } from './pipeline/notify';
import {
  COMPANIES_PATH, emptyCompaniesFile, loadCompaniesFile, saveCompaniesFile, type CompaniesFile,
} from './research/companies-file';
import { diffCompanies, formatCompaniesMessage } from './research/summary';
import { openaiResearchClient, researchTopCompanies } from './research/top-companies';
import { buildBoardCache, discoverBoards, type ProbeFn } from './research/verify-boards';

// Deterministic dry-run probe: fixture companies with these boards "exist".
const fakeProbe: ProbeFn = async (vendor, slug) =>
  (vendor === 'greenhouse' && ['stripe', 'datadog'].includes(slug)) ||
  (vendor === 'personio' && slug === 'personio')
    ? 'hit'
    : 'miss';

async function main(): Promise<void> {
  const totalStart = Date.now();
  const dryRun = process.argv.includes('--dry-run');
  const config = loadConfig();

  const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  const chatId = process.env.TELEGRAM_CHAT_ID ?? '';
  if (!dryRun && (!token || !chatId)) {
    throw new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set');
  }

  const previous = dryRun ? emptyCompaniesFile() : loadCompaniesFile(COMPANIES_PATH);

  // 1. Research. Any failure here or in discovery aborts before the artifact
  //    is written, so last week's file survives a bad run.
  const researched = dryRun
    ? loadFixtureCompanies()
    : await researchTopCompanies(openaiResearchClient(new OpenAI()), config.models.research, config.topCompanies.count);
  console.log(`researched ${researched.length} companies`);

  // 2. Verify boards
  const entries = await discoverBoards(researched, buildBoardCache(previous), dryRun ? fakeProbe : undefined);
  entries.sort((a, b) => b.estSeniorTotalCompEur - a.estSeniorTotalCompEur);
  console.log(`boards verified: ${entries.filter((e) => e.board).length}/${entries.length}`);

  // 3. Persist
  const current: CompaniesFile = { updatedAt: new Date().toISOString(), companies: entries };
  if (!dryRun) saveCompaniesFile(COMPANIES_PATH, current);

  // 4. Notify
  const message = formatCompaniesMessage(current, diffCompanies(previous, current));
  if (dryRun) console.log('[dry-run companies]\n' + message);
  else await sendTelegram(token, chatId, message);

  console.log(`done in ${((Date.now() - totalStart) / 1000).toFixed(0)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
