export type WorkMode = 'remote' | 'hybrid' | 'onsite' | 'unknown';

export interface JobPosting {
  id: string; // `${source}:${sourceId}`
  source: string;
  url: string;
  title: string;
  company: string;
  location: string; // raw location text, '' if unknown
  workMode: WorkMode;
  description: string; // plain text
  postedAt: string; // ISO 8601
  salary?: string;
}

export type JobStatus = 'seen' | 'scored' | 'alerted' | 'digested' | 'archived';

export interface ScoreResult {
  score: number;
  stackFit: number;
  seniorityFit: number;
  locationFit: number;
  reasoning: string;
  language: 'en' | 'de' | 'other';
}

export interface JobRecord {
  posting: JobPosting;
  fuzzyKey: string;
  status: JobStatus;
  score?: ScoreResult;
  matchFile?: string;
  languageFlag?: 'de';
  firstSeenAt: string;
  updatedAt: string;
}

export interface State {
  jobs: Record<string, JobRecord>;
  sourceFailures: Record<string, { consecutiveFailures: number; lastError: string }>;
}
