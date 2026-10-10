export type UserRecord = {
  userId: string;
  createdAt: number;
  lastActiveAt: number;
  status: 'active' | 'disabled' | 'deleted';
};

export type CreditAccount = {
  userId: string;
  period: string;
  bucketId: string;
  available: number;
  reserved: number;
  monthlyGrant: number;
  periodEndsAt: number;
};

export type CreditBucket = {
  userId: string;
  period: string;
  granted: number;
  available: number;
  reserved: number;
  consumed: number;
  expired: number;
  createdAt: number;
  endsAt: number;
};

export type CreditReservation = {
  reservationId: string;
  userId: string;
  bucketId: string;
  state: 'pending' | 'consumed' | 'released';
  createdAt: number;
  settledAt: number | null;
};

export type CreditLedgerEntry = {
  userId: string;
  bucketId: string;
  operation: 'GRANT' | 'EXPIRE' | 'RESERVE' | 'CONSUME' | 'RELEASE';
  reservationId: string | null;
  deltaAvailable: number;
  deltaReserved: number;
  deltaConsumed: number;
  deltaExpired: number;
  createdAt: number;
};
import type { LayoutVersionTuple, TitleAlignment } from '@learn/paper-core';
import type { GenerationFailureCode, JobStatus } from './contracts.js';


export type GenerationJob = {
  jobId: string; userId: string; requestId: string; requestKey: string;
  toolId: 'paper'; usageType: 'pdf'; registryId: string; versions: LayoutVersionTuple;
  batchId: string; status: JobStatus; createdAt: number; deadline: number;
  startedAt: number | null; finishedAt: number | null; pageCount: number | null;
  errorCode: GenerationFailureCode | null; candidatePath: string | null; fileId: string | null;
  fileExpiresAt: number | null; fileBytes: number | null; fileSha256: string | null;
  recordExpiresAt: number;
  executionClaimed: boolean;
};
export type PdfCandidate = {
  candidateId: string; jobId: string; userId: string; batchId: string;
  path: string; fileId: string; bytes: number; sha256: string; pageCount: number;
  createdAt: number; pdfRetentionMs: number; state: 'pending' | 'committed' | 'deleting' | 'deleted';
};
export type GenerationRequestRecord = {
  userId: string; requestId: string; jobId: string; fingerprint: string;
  fingerprintKeyId: string; fingerprintVersion: string; defaultTitleAlign: TitleAlignment;
  windowExpiresAt: number; createdAt: number; retainUntil: number; deleted: boolean;
  inputLimits: { maxInputCodeUnits: number; maxGraphemes: number; maxPages: number };
};
