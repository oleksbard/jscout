import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { JobPosting, JobRecord, JobStatus, State } from '../types';

export function emptyState(): State {
  return { jobs: {}, sourceFailures: {} };
}

export function loadState(path: string): State {
  if (!existsSync(path)) return emptyState();
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<State>;
  return { ...emptyState(), ...parsed };
}

export function saveState(path: string, state: State): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
}

export function addJob(state: State, posting: JobPosting, fuzzyKey: string, languageFlag?: 'de'): JobRecord {
  const now = new Date().toISOString();
  const record: JobRecord = {
    posting,
    fuzzyKey,
    status: 'seen',
    firstSeenAt: now,
    updatedAt: now,
    ...(languageFlag ? { languageFlag } : {}),
  };
  state.jobs[posting.id] = record;
  return record;
}

export function setStatus(record: JobRecord, status: JobStatus): void {
  record.status = status;
  record.updatedAt = new Date().toISOString();
}

export function recordSourceFailure(state: State, source: string, error: string): void {
  const prev = state.sourceFailures[source];
  state.sourceFailures[source] = {
    consecutiveFailures: (prev?.consecutiveFailures ?? 0) + 1,
    lastError: error,
  };
}

export function clearSourceFailure(state: State, source: string): void {
  delete state.sourceFailures[source];
}
