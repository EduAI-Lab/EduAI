/**
 * Unit tests for ensureCourseAnchor (#1114 / #1270).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@eduai/question-maker-prisma-client';

const executeRaw = vi.fn();
const txFindUnique = vi.fn();
const txCreate = vi.fn();
const prismaFindUnique = vi.fn();
const transaction = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    $transaction: (...args) => transaction(...args),
    course: {
      findUnique: (...args) => prismaFindUnique(...args),
    },
  },
}));

const { ensureCourseAnchor, courseAnchorAdvisoryLockKey, COURSE_ANCHOR_LOCK_NS } = await import(
  '../../src/services/ensureCourseAnchor.js'
);

describe('ensureCourseAnchor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeRaw.mockResolvedValue(undefined);
    transaction.mockImplementation(async (fn) =>
      fn({
        $executeRaw: executeRaw,
        course: { findUnique: txFindUnique, create: txCreate },
      }),
    );
  });

  it('returns an existing row without creating', async () => {
    const existing = { id: 1, userId: 'u1', coreCourseId: 'core-1' };
    txFindUnique.mockResolvedValue(existing);

    const result = await ensureCourseAnchor('u2', 'core-1');

    expect(result).toEqual({ course: existing, created: false });
    expect(txCreate).not.toHaveBeenCalled();
    expect(executeRaw).toHaveBeenCalled();
    expect(COURSE_ANCHOR_LOCK_NS).toBe(1114);
    expect(courseAnchorAdvisoryLockKey('core-1')).toBeGreaterThan(0);
  });

  it('creates when no row exists', async () => {
    txFindUnique.mockResolvedValue(null);
    const created = { id: 2, userId: 'u1', coreCourseId: 'core-2' };
    txCreate.mockResolvedValue(created);

    const result = await ensureCourseAnchor('u1', 'core-2');

    expect(result).toEqual({ course: created, created: true });
    expect(txCreate).toHaveBeenCalledWith({
      data: { userId: 'u1', coreCourseId: 'core-2' },
    });
  });

  it('rereads outside the aborted transaction after P2002', async () => {
    txFindUnique.mockResolvedValue(null);
    txCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.19.3',
        meta: { target: ['core_course_id'] },
      }),
    );
    const raced = { id: 3, userId: 'other', coreCourseId: 'core-3' };
    prismaFindUnique.mockResolvedValue(raced);

    const result = await ensureCourseAnchor('u1', 'core-3');

    expect(result).toEqual({ course: raced, created: false });
    // Recovery must use the root client — not `tx` — after P2002 aborts the txn.
    expect(prismaFindUnique).toHaveBeenCalledWith({ where: { coreCourseId: 'core-3' } });
  });

  it('rethrows P2002 when the outside reread still finds nothing', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.19.3',
      meta: { target: ['core_course_id'] },
    });
    txFindUnique.mockResolvedValue(null);
    txCreate.mockRejectedValue(err);
    prismaFindUnique.mockResolvedValue(null);

    await expect(ensureCourseAnchor('u1', 'core-missing')).rejects.toBe(err);
  });

  it('rethrows non-unique errors from the transaction', async () => {
    const err = new Error('connection terminated');
    txFindUnique.mockRejectedValue(err);

    await expect(ensureCourseAnchor('u1', 'core-x')).rejects.toBe(err);
    expect(prismaFindUnique).not.toHaveBeenCalled();
  });
});
