import OpenAI from 'openai';
import { loadConfig } from './config';
import { loadFixtureCompanies } from './dry-run';
import { sendTelegram } from './pipeline/notify';
import {
  COMPANIES_PATH, emptyCompaniesFile, loadCompaniesFile, saveCompaniesFile, type CompaniesFile,
} from './research/companies-file';
import { curatedListFiles, loadCuratedCompanies } from './research/curated-list';
import { diffCompanies, formatCompaniesMessage } from './research/summary';
import { openaiResearchClient, researchTopCompanies } from './research/top-companies';
import { buildBoardCache, discoverBoards, type ProbeFn } from './research/verify-boards';

// Web-search research on a reasoning model regularly exceeds the SDK's 10-min
// default request timeout (seen as APIConnectionTimeoutError in CI). One retry
// keeps the worst case bounded at ~1h.
const RESEARCH_TIMEOUT_MS = 30 * 60 * 1000;

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

  // 1. Source the companies: curated lists in data/ win; LLM research is the
  //    fallback. Any failure here or in discovery aborts before the artifact
  //    is written, so last week's file survives a bad run.
  const researchStart = Date.now();
  const curated = curatedListFiles();
  let researched;
  if (dryRun) {
    researched = loadFixtureCompanies();
  } else if (curated.length > 0) {
    researched = loadCuratedCompanies();
    console.log(`using ${curated.length} curated list(s): ${curated.join(', ')} — LLM research skipped`);
  } else {
    console.log(`researching top ${config.topCompanies.count} companies with ${config.models.research} + web search (usually takes a few minutes)...`);
    // The research call is one long await — heartbeat so the run never looks hung.
    const heartbeat = setInterval(() => {
      console.log(`research still running (${Math.round((Date.now() - researchStart) / 1000)}s)...`);
    }, 30_000);
    try {
      researched = await researchTopCompanies(
        openaiResearchClient(new OpenAI({ timeout: RESEARCH_TIMEOUT_MS, maxRetries: 1 })),
        config.models.research,
        config.topCompanies.count,
      );
    } finally {
      clearInterval(heartbeat);
    }
  }
  console.log(`researched ${researched.length} companies in ${((Date.now() - researchStart) / 1000).toFixed(0)}s`);

  // 2. Verify boards
  const discoveryStart = Date.now();
  console.log(`verifying job boards for ${researched.length} companies (concurrency 5)...`);
  const entries = await discoverBoards(researched, buildBoardCache(previous), dryRun ? fakeProbe : undefined, console.log);
  entries.sort((a, b) => b.estSeniorTotalCompEur - a.estSeniorTotalCompEur);
  console.log(`boards verified: ${entries.filter((e) => e.board).length}/${entries.length} in ${((Date.now() - discoveryStart) / 1000).toFixed(0)}s`);

  // 3. Persist
  const current: CompaniesFile = { updatedAt: new Date().toISOString(), companies: entries };
  if (!dryRun) saveCompaniesFile(COMPANIES_PATH, current);

  // 4. Notify
  const message = formatCompaniesMessage(current, diffCompanies(previous, current));
  if (dryRun) {
    console.log('[dry-run companies]\n' + message);
  } else {
    console.log('sending telegram summary...');
    await sendTelegram(token, chatId, message);
  }

  console.log(`done in ${((Date.now() - totalStart) / 1000).toFixed(0)}s`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
