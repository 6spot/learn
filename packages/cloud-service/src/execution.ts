import { RuntimeError } from '@learn/cloud-runtime';
import { assertLayoutVersionsMatch } from '@learn/paper-core';
import { ServiceError, type GenerationExecution, type GenerationExecutor, type GenerationExecutorDependencies,
  type GenerationFailureCode, type ServiceConfig } from './contracts.js';
import { validateConfig } from './config.js';
import type { GenerationJob, PdfCandidate } from './model.js';
import { failJobInTransaction, isTerminal } from './jobs.js';
import { candidateId, candidatePath, cleanupCandidate, isPdfEnvelope, settleCandidate, verifyCandidate } from './artifacts.js';

/** Composes the actual business runner with a trusted PDF encoder and private storage. */
export function createGenerationExecutor(deps: GenerationExecutorDependencies, rawConfig: ServiceConfig): GenerationExecutor {
  const config = validateConfig(rawConfig);
  const policy = config.generation;
  if (!policy) throw new ServiceError('INVALID_CONFIG');

  const fail = (execution: GenerationExecution, code: GenerationFailureCode) => deps.store.transaction(tx =>
    failJobInTransaction(tx, execution.jobId, execution.batchId, deps.clock.now(), code, 'GENERATING'));

  async function run(execution: GenerationExecution): Promise<void> {
    const claimed = await deps.store.transaction(async tx => {
      const job = await tx.get<GenerationJob>('generation_jobs', execution.jobId);
      if (!job) throw new ServiceError('NOT_FOUND');
      if (isTerminal(job) || job.batchId !== execution.batchId || job.executionClaimed) return false;
      if (job.userId !== execution.userId || job.status !== 'GENERATING' || job.registryId !== execution.published.registryId ||
          job.pageCount !== execution.layout.pages.length) throw new ServiceError('INVARIANT_VIOLATION');
      assertLayoutVersionsMatch(job.versions, execution.layout.versions);
      assertLayoutVersionsMatch(job.versions, execution.published.preset.versions);
      if (deps.clock.now() >= job.deadline) {
        await failJobInTransaction(tx, job.jobId, job.batchId, deps.clock.now(), 'EXECUTION_TIMEOUT', 'GENERATING');
        return false;
      }
      await tx.set('generation_jobs', job.jobId, { ...job, executionClaimed: true });
      return true;
    });
    if (!claimed) return;

    let bytes: Uint8Array;
    let failure: GenerationFailureCode = 'EXECUTION_FAILED';
    try {
      const rendered = await deps.renderer.render(execution, { maxOutputBytes: policy!.maxPdfBytes });
      if (!(rendered instanceof Uint8Array) || !isPdfEnvelope(rendered)) { failure = 'PDF_INVALID'; throw new Error(); }
      if (rendered.length > policy!.maxPdfBytes) { failure = 'PDF_RESOURCE_LIMIT'; throw new Error(); }
      // Own the transient bytes across storage/crypto awaits. Never persist layout or content.
      bytes = Uint8Array.from(rendered);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === 'PDF_RESOURCE_LIMIT') failure = 'PDF_RESOURCE_LIMIT';
        else if (error.code === 'PDF_RESOURCE_MISSING' || error.code === 'PDF_RESOURCE_MISMATCH') failure = 'RESOURCE_UNAVAILABLE';
        else if (error.code === 'PDF_INVALID_LAYOUT') failure = 'PDF_INVALID';
      }
      await fail(execution, failure);
      return;
    }
    const sha256 = await deps.crypto.sha256(bytes);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new ServiceError('INTERNAL_ERROR');
    const id = candidateId(execution.jobId, execution.batchId);
    const path = candidatePath(execution.jobId, execution.batchId);
    const candidate: PdfCandidate = { candidateId: id, jobId: execution.jobId, userId: execution.userId,
      batchId: execution.batchId, path, fileId: deps.storage.resolve(path), bytes: bytes.length, sha256,
      pageCount: execution.layout.pages.length, createdAt: deps.clock.now(), state: 'pending', pdfRetentionMs: policy!.pdfRetentionMs };
    const registered = await deps.store.transaction(async tx => {
      const job = await tx.get<GenerationJob>('generation_jobs', execution.jobId);
      if (!job || isTerminal(job) || job.batchId !== execution.batchId) return false;
      if (job.status !== 'GENERATING' || !job.executionClaimed || job.candidatePath !== null) throw new ServiceError('INVARIANT_VIOLATION');
      if (deps.clock.now() >= job.deadline) {
        await failJobInTransaction(tx, job.jobId, job.batchId, deps.clock.now(), 'EXECUTION_TIMEOUT', 'GENERATING');
        return false;
      }
      await tx.create('pdf_candidates', id, candidate);
      await tx.set('generation_jobs', job.jobId, { ...job, candidatePath: path });
      return true;
    });
    if (!registered) return;

    let returnedId: string | undefined;
    try { returnedId = await deps.storage.put(path, bytes); } catch {
      // Upload may have succeeded. Only exact readback or trusted timeout can settle.
    }
    if (returnedId !== undefined && returnedId !== candidate.fileId) throw new ServiceError('EXECUTION_OUTCOME_UNKNOWN');
    const verification = await verifyCandidate(deps, candidate);
    if (verification === 'unavailable') {
      // A late result can still be removable after a competing terminal transition.
      await cleanupCandidate(deps, id);
      throw new ServiceError('EXECUTION_OUTCOME_UNKNOWN');
    }
    if (verification === 'invalid') await fail(execution, 'PDF_INVALID');
    else await settleCandidate(deps, candidate);
    await cleanupCandidate(deps, id);
  }

  return { async execute(execution) {
    let entered = false;
    try { await deps.bridge.invoke(execution, async input => { entered = true; await run(input); }); }
    catch (error) {
      if (!entered && error instanceof RuntimeError && error.code === 'EXECUTION_NOT_STARTED') {
        await deps.store.transaction(async tx => {
          const job = await tx.get<GenerationJob>('generation_jobs', execution.jobId);
          // A failed duplicate invocation cannot cancel a different invocation that already claimed execution.
          if (job && !job.executionClaimed) await failJobInTransaction(tx, job.jobId, execution.batchId,
            deps.clock.now(), 'EXECUTION_FAILED', 'GENERATING');
        });
        return;
      }
      // No raw renderer/storage/database payload can cross the public boundary.
      throw new ServiceError('EXECUTION_OUTCOME_UNKNOWN');
    }
  } };
}
