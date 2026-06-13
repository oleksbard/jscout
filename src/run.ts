import { mkdirSync, writeFileSync } from 'node:fs';
import OpenAI from 'openai';
import { loadConfig } from './config';
import { fakeScore, loadFixturePostings } from './dry-run';
import { loadProfile } from './profile';
import { mapWithConcurrency } from './util';
import { dedupe, fuzzyKey } from './pipeline/dedupe';
import { hardFilter } from './pipeline/filter';
import { formatAlertMessage, formatDigestMessage, sendTelegram } from './pipeline/notify';
import { openaiScoringClient, scoreJob } from './pipeline/score';
import { selectAlertJobs, selectDigestJobs } from './pipeline/select';
import {
  addJob, clearSourceFailure, emptyState, loadState, recordSourceFailure, saveState, setStatus,
} from './pipeline/state';
import { matchFilename, openaiTailoringClient, tailorJob } from './pipeline/tailor';
import { buildSourceTasks, runSources } from './sources/index';

const STATE_PATH = 'state/jobs.json';
const PROFILE_PATH = 'profile.md';

async function main(): Promise<void> {
  const totalStart = Date.now();
  const mode = process.argv.includes('--mode=digest') ? 'digest' : 'alerts';
  const dryRun = process.argv.includes('--dry-run');
  const config = loadConfig();

  // Fix 2: fail fast on missing Telegram secrets before any network/LLM work
  const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  const chatId = process.env.TELEGRAM_CHAT_ID ?? '';
  if (!dryRun && (!token || !chatId)) {
    throw new Error('TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set');
  }

  // Fix 3: dry-run uses empty state, never reads real state file
  const state = dryRun ? emptyState() : loadState(STATE_PATH);
  const profile = dryRun ? 'dry-run profile' : await loadProfile(PROFILE_PATH);

  try {
    // 1. Fetch
    let postings;
    let failures: { source: string; error: string }[] = [];
    if (dryRun) {
      postings = loadFixturePostings();
    } else {
      // Fix 7: build source tasks once, reuse for both runSources and clearSourceFailure
      const sourceTasks = buildSourceTasks(config, { includeJsearch: mode === 'digest' });
      const result = await runSources(sourceTasks);
      postings = result.postings;
      failures = result.failures;
      for (const f of failures) recordSourceFailure(state, f.source, f.error);
      const failedNames = new Set(failures.map((f) => f.source));
      for (const t of sourceTasks) {
        if (!failedNames.has(t.name)) clearSourceFailure(state, t.name);
      }
    }
    console.log(`fetched ${postings.length} postings (${failures.length} source failures)`);

    // 2. Dedupe + 3. Hard filter
    const fresh = dedupe(postings, state);
    const { kept, flaggedDe } = hardFilter(fresh, config);
    console.log(`new: ${fresh.length}, after hard filter: ${kept.length}`);

    // 4. Score (capped)
    const openai = dryRun ? null : new OpenAI();
    const scoringClient = openai ? openaiScoringClient(openai) : null;

    // Snapshot retry candidates BEFORE this run adds new 'seen' records.
    const retryCandidates = Object.values(state.jobs).filter((r) => r.status === 'seen' && !r.score);
    let scoringBudget = config.maxJobsScoredPerRun;
    const toScore = kept.slice(0, scoringBudget);
    scoringBudget -= toScore.length;
    if (kept.length > toScore.length) console.log(`cost cap: scoring ${toScore.length}/${kept.length}`);

    // One combined work list: fresh postings (added to state now) + retries within the same budget.
    const scoringRecords = toScore.map((posting) =>
      addJob(state, posting, fuzzyKey(posting), flaggedDe.has(posting.id) ? 'de' : undefined),
    );
    const retries = retryCandidates.slice(0, Math.max(0, scoringBudget));
    if (retryCandidates.length > retries.length) {
      console.log(`cost cap: skipping ${retryCandidates.length - retries.length} pending re-scorings`);
    }
    scoringRecords.push(...retries);

    const scoringStart = Date.now();
    let scoredOk = 0;
    let scoredFailed = 0;
    if (scoringRecords.length > 0) {
      console.log(`scoring ${scoringRecords.length} jobs (concurrency ${config.scoringConcurrency})...`);
    }
    await mapWithConcurrency(scoringRecords, config.scoringConcurrency, async (record) => {
      const jobStart = Date.now();
      try {
        record.score = scoringClient
          ? await scoreJob(scoringClient, config.models.scoring, profile, record.posting)
          : fakeScore(record.posting);
        setStatus(record, 'scored');
        scoredOk += 1;
        const seconds = ((Date.now() - jobStart) / 1000).toFixed(1);
        console.log(
          `scored ${scoredOk + scoredFailed}/${scoringRecords.length}: ${record.score.score}/100 — ${record.posting.title} @ ${record.posting.company} (${seconds}s)`,
        );
      } catch (err) {
        scoredFailed += 1;
        console.error(`scoring failed for ${record.posting.id}, will retry next run:`, err);
        // stays 'seen'; next run re-scores everything still in 'seen'.
      }
    });
    if (scoringRecords.length > 0) {
      console.log(`scoring done in ${((Date.now() - scoringStart) / 1000).toFixed(0)}s (${scoredOk} ok, ${scoredFailed} failed)`);
    }

    // 5. Tailor everything digest-worthy that has no match file yet
    if (config.tailor) {
      const tailoringClient = openai ? openaiTailoringClient(openai) : null;
      const date = new Date().toISOString().slice(0, 10);
      if (!dryRun) mkdirSync('matches', { recursive: true });
      for (const record of Object.values(state.jobs)) {
        const score = record.score;
        if (!score || score.score < config.thresholds.digest || record.matchFile) continue;
        if (record.status === 'archived') continue;
        const file = matchFilename(record.posting, date);
        const tailorStart = Date.now();
        try {
          const markdown = tailoringClient
            ? await tailorJob(tailoringClient, config.models.tailoring, profile, record.posting, score)
            : `# dry-run match for ${record.posting.id}\n`;
          if (!dryRun) writeFileSync(file, markdown);
          record.matchFile = file;
          console.log(`tailored: ${file} (${((Date.now() - tailorStart) / 1000).toFixed(1)}s)`);
        } catch (err) {
          console.error(`tailoring failed for ${record.posting.id}, will retry next run:`, err);
        }
      }
    } else {
      console.log('tailoring disabled (config.tailor=false)');
    }

    // 6. Notify
    if (mode === 'alerts') {
      // Fix 6: per-send isolation — one failure doesn't abort later sends
      const alertJobs = selectAlertJobs(state, config.thresholds.hot);
      if (alertJobs.length > 0) console.log(`sending ${alertJobs.length} alert(s)...`);
      for (const record of alertJobs) {
        const message = formatAlertMessage(record);
        try {
          if (dryRun) console.log('[dry-run alert]\n' + message);
          else await sendTelegram(token, chatId, message);
          setStatus(record, 'alerted');
        } catch (err) {
          console.error(`alert send failed for ${record.posting.id}, will retry next run:`, err);
        }
      }
    } else {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const digestJobs = selectDigestJobs(state, config.thresholds.digest, since);
      console.log(`digest: ${digestJobs.length} match(es) in the last 24h`);
      const failing = Object.entries(state.sourceFailures)
        .filter(([, f]) => f.consecutiveFailures >= 3)
        .map(([name]) => name);
      if (digestJobs.length === 0 && failing.length === 0) {
        // Nothing found and nothing to warn about — stay silent instead of sending "No new matches".
        console.log('digest: nothing to send, skipping Telegram message');
      } else {
        const message = formatDigestMessage(digestJobs, failing);
        if (dryRun) console.log('[dry-run digest]\n' + message);
        else await sendTelegram(token, chatId, message);
        for (const record of digestJobs) setStatus(record, 'digested');
      }
      // Archive scored-but-below-threshold jobs older than 24h
      for (const record of Object.values(state.jobs)) {
        if (record.status === 'scored' && (record.score?.score ?? 0) < config.thresholds.digest && record.firstSeenAt < since) {
          setStatus(record, 'archived');
        }
      }
    }

    console.log(`done in ${((Date.now() - totalStart) / 1000).toFixed(0)}s`);
  } finally {
    // Fix 1: persist state even on partial failure so status advances are not lost
    if (!dryRun) saveState(STATE_PATH, state);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
