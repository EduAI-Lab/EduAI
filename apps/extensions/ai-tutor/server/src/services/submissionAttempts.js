import { prisma } from '../config/database.js';

export const ATTEMPT_NUMBER_MAX_RETRIES = 3;

const ATTEMPT_NUMBER_CONSTRAINT = 'Submission_userId_activityId_attemptNumber_key';
const ATTEMPT_NUMBER_FIELDS = ['userId', 'activityId', 'attemptNumber'];

export function isAttemptNumberConflict(error) {
  if (error?.code !== 'P2002') return false;

  const target = error.meta?.target;
  if (target === ATTEMPT_NUMBER_CONSTRAINT) return true;
  if (!Array.isArray(target) || target.length !== ATTEMPT_NUMBER_FIELDS.length) return false;

  return target.every((field, index) => field === ATTEMPT_NUMBER_FIELDS[index]);
}

export async function withAttemptNumberRetry(
  operation,
  maxRetries = ATTEMPT_NUMBER_MAX_RETRIES,
) {
  for (let retryCount = 0; ; retryCount += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isAttemptNumberConflict(error) || retryCount >= maxRetries) throw error;
    }
  }
}

export function createSubmissionWithNextAttempt({
  userId,
  activityId,
  response,
  aiFeedback,
  isCorrect,
}) {
  return withAttemptNumberRetry(() =>
    prisma.$transaction(async (tx) => {
      const aggregate = await tx.submission.aggregate({
        where: { userId, activityId },
        _max: { attemptNumber: true },
      });
      const attemptNumber = (aggregate._max.attemptNumber ?? 0) + 1;

      return tx.submission.create({
        data: {
          userId,
          activityId,
          attemptNumber,
          response,
          aiFeedback,
          isCorrect,
        },
      });
    }),
  );
}
