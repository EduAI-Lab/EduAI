/**
 * Unit tests for authService.findOrCreateUser without a real DB or network needed.
 * Mocks the Prisma client only — no demo-course seeding happens on the
 * login path anymore (see tests/helpers/seedCoursesFixture.js for the retired
 * seeding logic, now a test-only fixture).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const upsert = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: { user: { upsert } },
}));

const { findOrCreateUser, resetUserRowCacheForTests } = await import(
  '../../src/services/authService.js'
);

describe('findOrCreateUser', () => {
  beforeEach(() => {
    upsert.mockReset();
    resetUserRowCacheForTests();
  });

  it('returns the existing user when a local row already exists', async () => {
    const existing = { id: 'u1', email: 'a@b.com', name: 'Alice' };
    upsert.mockResolvedValue(existing);

    const result = await findOrCreateUser({ id: 'u1', email: 'a@b.com', name: 'Alice' });

    expect(result).toBe(existing);
  });

  it('creates a local user row when none exists', async () => {
    const newUser = { id: 'u2', email: 'b@c.com', name: 'Bob' };
    upsert.mockResolvedValue(newUser);

    const result = await findOrCreateUser({ id: 'u2', email: 'b@c.com', name: 'Bob' });

    expect(result).toBe(newUser);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u2' },
        update: {},
        create: expect.objectContaining({ id: 'u2', email: 'b@c.com' }),
      }),
    );
  });

  it('stores null for name when not provided', async () => {
    const newUser = { id: 'u7', email: 'g@h.com', name: null };
    upsert.mockResolvedValue(newUser);

    await findOrCreateUser({ id: 'u7', email: 'g@h.com' });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ name: null }),
      }),
    );
  });
});

/**
 * The upsert is `update: {}` by design, so once the row exists every repeat is
 * a write that changes nothing. requireAuth runs on ~80 handlers, so the id is
 * memoized and the upsert skipped in the steady state (#1388).
 */
describe('findOrCreateUser user row cache', () => {
  beforeEach(() => {
    upsert.mockReset();
    upsert.mockResolvedValue({ id: 'u1', email: 'a@b.com', name: 'Alice' });
    resetUserRowCacheForTests();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips the upsert on a repeat call for the same user', async () => {
    const coreUser = { id: 'u1', email: 'a@b.com', name: 'Alice' };

    await findOrCreateUser(coreUser);
    await findOrCreateUser(coreUser);
    await findOrCreateUser(coreUser);

    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('upserts once per distinct user', async () => {
    await findOrCreateUser({ id: 'u1', email: 'a@b.com' });
    await findOrCreateUser({ id: 'u2', email: 'b@c.com' });
    await findOrCreateUser({ id: 'u1', email: 'a@b.com' });

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls.map(([arg]) => arg.where.id)).toEqual(['u1', 'u2']);
  });

  it('retries the upsert when the first attempt fails', async () => {
    upsert.mockRejectedValueOnce(new Error('db down'));

    await expect(findOrCreateUser({ id: 'u1', email: 'a@b.com' })).rejects.toThrow('db down');
    await findOrCreateUser({ id: 'u1', email: 'a@b.com' });

    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('upserts again once the entry goes stale', async () => {
    vi.useFakeTimers();

    await findOrCreateUser({ id: 'u1', email: 'a@b.com' });
    vi.advanceTimersByTime(15 * 60_000 + 1);
    await findOrCreateUser({ id: 'u1', email: 'a@b.com' });

    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('returns undefined on a cache hit so callers do not rely on the row', async () => {
    const first = await findOrCreateUser({ id: 'u1', email: 'a@b.com' });
    const second = await findOrCreateUser({ id: 'u1', email: 'a@b.com' });

    expect(first).toEqual({ id: 'u1', email: 'a@b.com', name: 'Alice' });
    expect(second).toBeUndefined();
  });
});
