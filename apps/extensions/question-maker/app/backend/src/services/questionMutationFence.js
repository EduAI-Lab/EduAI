/**
 * Serializes every mutation that can change a question's Core snapshot.
 *
 * The question row is the shared unit for variant content, review state, and
 * Core-backed metadata (`type` / `primaryTopicId`). A transaction-scoped
 * advisory lock keeps those paths ordered without holding a database
 * transaction across the outbound Core request.
 */
import { prisma } from '../config/database.js';

// Keep this namespace separate from the other advisory locks in QM. The
// second key is the question_metadata integer primary key.
const QUESTION_MUTATION_LOCK_NAMESPACE = 108011;
const QUESTION_MUTATION_TX_TIMEOUT_MS = 15_000;

// Integration tests install a barrier here to prove ordering without sleeps.
// It is intentionally unset in normal application execution.
let fenceObserver = null;

/** Install a deterministic test observer; returns a restore callback. */
export function setQuestionMutationFenceObserver(observer) {
  const previous = fenceObserver;
  fenceObserver = typeof observer === 'function' ? observer : null;
  return () => {
    fenceObserver = previous;
  };
}

/**
 * Runs a question mutation while holding the per-question transaction fence.
 * `operation` receives the transaction-bound Prisma client and must perform
 * all authoritative reads and writes through it.
 */
export async function withQuestionMutationFence(questionId, operation) {
  const parsedQuestionId = Number(questionId);
  if (!Number.isInteger(parsedQuestionId) || parsedQuestionId <= 0) {
    throw Object.assign(new Error('Question not found'), { status: 404 });
  }

  return prisma.$transaction(async (tx) => {
    // Both arguments are explicitly int-cast so PostgreSQL resolves the
    // pg_advisory_xact_lock(int,int) overload consistently through Prisma.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${QUESTION_MUTATION_LOCK_NAMESPACE}::int, ${parsedQuestionId}::int)`;

    if (fenceObserver) {
      await fenceObserver({ questionId: parsedQuestionId, tx });
    }

    return operation(tx);
  }, {
    maxWait: QUESTION_MUTATION_TX_TIMEOUT_MS,
    timeout: QUESTION_MUTATION_TX_TIMEOUT_MS,
  });
}

export const QUESTION_MUTATION_LOCK_KEY = QUESTION_MUTATION_LOCK_NAMESPACE;
