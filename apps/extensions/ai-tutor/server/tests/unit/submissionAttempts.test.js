import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTransaction = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    $transaction: (...args) => mockTransaction(...args),
  },
}));

const {
  ATTEMPT_NUMBER_MAX_RETRIES,
  createSubmissionWithNextAttempt,
  isAttemptNumberConflict,
  withAttemptNumberRetry,
} = await import('../../src/services/submissionAttempts.js');

const attemptNumberConflict = {
  code: 'P2002',
  meta: { target: ['userId', 'activityId', 'attemptNumber'] },
};

beforeEach(() => {
  mockTransaction.mockReset();
});

describe('isAttemptNumberConflict', () => {
  it('accepts the exact attempt-number field target', () => {
    expect(isAttemptNumberConflict(attemptNumberConflict)).toBe(true);
  });

  it('accepts the exact generated constraint name', () => {
    expect(
      isAttemptNumberConflict({
        code: 'P2002',
        meta: { target: 'Submission_userId_activityId_attemptNumber_key' },
      }),
    ).toBe(true);
  });

  it.each([
    [{ code: 'P2002' }],
    [{ code: 'P2002', meta: { target: ['activityId', 'userId', 'attemptNumber'] } }],
    [{ code: 'P2002', meta: { target: ['userId', 'activityId'] } }],
    [{ code: 'P2002', meta: { target: ['slug'] } }],
    [{ code: 'P2025', meta: { target: ['userId', 'activityId', 'attemptNumber'] } }],
    [new Error('database unavailable')],
  ])('rejects a missing, incorrect, or unrelated target', (error) => {
    expect(isAttemptNumberConflict(error)).toBe(false);
  });
});

describe('withAttemptNumberRetry', () => {
  it('returns a first-attempt success without retrying', async () => {
    const operation = vi.fn().mockResolvedValue('created');

    await expect(withAttemptNumberRetry(operation)).resolves.toBe('created');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries an exact attempt-number conflict and returns the next result', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(attemptNumberConflict)
      .mockResolvedValueOnce('created');

    await expect(withAttemptNumberRetry(operation)).resolves.toBe('created');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('immediately rethrows an unrelated P2002 error', async () => {
    const error = { code: 'P2002', meta: { target: ['slug'] } };
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withAttemptNumberRetry(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('immediately rethrows a non-P2002 error', async () => {
    const error = new Error('database unavailable');
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withAttemptNumberRetry(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('stops after the configured retry bound and rethrows the final conflict', async () => {
    const operation = vi.fn().mockRejectedValue(attemptNumberConflict);

    await expect(withAttemptNumberRetry(operation)).rejects.toBe(attemptNumberConflict);
    expect(operation).toHaveBeenCalledTimes(ATTEMPT_NUMBER_MAX_RETRIES + 1);
  });
});

describe('createSubmissionWithNextAttempt', () => {
  it('reads the scoped maximum and creates the next attempt inside one transaction', async () => {
    const aggregate = vi.fn().mockResolvedValue({ _max: { attemptNumber: 2 } });
    const createdSubmission = { id: 17, attemptNumber: 3 };
    const create = vi.fn().mockResolvedValue(createdSubmission);
    mockTransaction.mockImplementation((operation) =>
      operation({ submission: { aggregate, create } }),
    );

    const data = {
      userId: 'student-1',
      activityId: 42,
      response: { answerText: null, answerOption: 1 },
      aiFeedback: { message: 'Nice! That looks right.' },
      isCorrect: true,
    };

    await expect(createSubmissionWithNextAttempt(data)).resolves.toBe(createdSubmission);
    expect(aggregate).toHaveBeenCalledWith({
      where: { userId: 'student-1', activityId: 42 },
      _max: { attemptNumber: true },
    });
    expect(create).toHaveBeenCalledWith({
      data: { ...data, attemptNumber: 3 },
    });
  });
});
