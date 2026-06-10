import type { JobRecord, State } from '../types';

export function selectAlertJobs(state: State, hotThreshold: number): JobRecord[] {
  return Object.values(state.jobs)
    .filter((r) => r.status === 'scored' && (r.score?.score ?? 0) >= hotThreshold)
    .sort((a, b) => (b.score?.score ?? 0) - (a.score?.score ?? 0));
}

export function selectDigestJobs(state: State, digestThreshold: number, sinceIso: string): JobRecord[] {
  return Object.values(state.jobs)
    .filter(
      (r) =>
        (r.status === 'scored' || r.status === 'alerted') &&
        (r.score?.score ?? 0) >= digestThreshold &&
        r.firstSeenAt >= sinceIso,
    )
    .sort((a, b) => (b.score?.score ?? 0) - (a.score?.score ?? 0));
}
