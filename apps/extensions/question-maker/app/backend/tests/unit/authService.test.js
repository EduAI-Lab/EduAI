/**
 * Unit tests for authService.findOrCreateUser without a real DB or network needed.
 * Mocks the Sequelize User and Course models and seedCoursesForNewUser.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const courseCount = vi.fn();
const findOrCreate = vi.fn();
const seedCoursesForNewUser = vi.fn();

vi.mock('../../src/schema/index.js', () => ({
  User: { findOrCreate },
  Course: { count: courseCount },
}));

vi.mock('../../src/services/seedNewUserService.js', () => ({
  seedCoursesForNewUser,
}));

const { findOrCreateUser } = await import('../../src/services/authService.js');

function makeUser(overrides = {}) {
  return {
    id: 'u1',
    email: 'a@b.com',
    name: 'Alice',
    coursesSeededAt: new Date(),
    update: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('findOrCreateUser', () => {
  beforeEach(() => {
    findOrCreate.mockReset();
    courseCount.mockReset();
    seedCoursesForNewUser.mockReset();
    seedCoursesForNewUser.mockResolvedValue(undefined);
    courseCount.mockResolvedValue(0);
  });

  it('returns the existing user when a local row already exists', async () => {
    const existing = makeUser({ id: 'u1', email: 'a@b.com', name: 'Alice' });
    findOrCreate.mockResolvedValue([existing, false]);

    const result = await findOrCreateUser({ id: 'u1', email: 'a@b.com', name: 'Alice' });

    expect(result).toBe(existing);
    expect(seedCoursesForNewUser).not.toHaveBeenCalled();
  });

  it('creates a local user row when none exists', async () => {
    const newUser = makeUser({ id: 'u2', email: 'b@c.com', name: 'Bob', coursesSeededAt: null });
    findOrCreate.mockResolvedValue([newUser, true]);

    const result = await findOrCreateUser({ id: 'u2', email: 'b@c.com', name: 'Bob' });

    expect(result).toBe(newUser);
    expect(findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u2' },
        defaults: expect.objectContaining({ id: 'u2', email: 'b@c.com' }),
      }),
    );
  });

  it('seeds courses for newly created users', async () => {
    const newUser = makeUser({ id: 'u3', email: 'c@d.com', name: 'Carol', coursesSeededAt: null });
    findOrCreate.mockResolvedValue([newUser, true]);
    courseCount.mockResolvedValue(0);

    await findOrCreateUser({ id: 'u3', email: 'c@d.com', name: 'Carol' });

    expect(seedCoursesForNewUser).toHaveBeenCalledWith('u3');
    expect(newUser.update).toHaveBeenCalledWith(expect.objectContaining({ coursesSeededAt: expect.any(Date) }));
  });

  it('does not seed courses for returning users who have already been seeded', async () => {
    const existing = makeUser({ id: 'u4', email: 'd@e.com', name: 'Dave', coursesSeededAt: new Date() });
    findOrCreate.mockResolvedValue([existing, false]);

    await findOrCreateUser({ id: 'u4', email: 'd@e.com', name: 'Dave' });

    expect(seedCoursesForNewUser).not.toHaveBeenCalled();
    expect(existing.update).not.toHaveBeenCalled();
  });

  it('seeds courses for existing users who have never been seeded and have 0 courses', async () => {
    const existing = makeUser({ id: 'u5', email: 'e@f.com', coursesSeededAt: null });
    findOrCreate.mockResolvedValue([existing, false]);
    courseCount.mockResolvedValue(0);

    await findOrCreateUser({ id: 'u5', email: 'e@f.com' });

    expect(seedCoursesForNewUser).toHaveBeenCalledWith('u5');
    expect(existing.update).toHaveBeenCalledWith(expect.objectContaining({ coursesSeededAt: expect.any(Date) }));
  });

  it('backfills the seeded flag for existing users who already have courses without re-seeding', async () => {
    const existing = makeUser({ id: 'u6', email: 'f@g.com', coursesSeededAt: null });
    findOrCreate.mockResolvedValue([existing, false]);
    courseCount.mockResolvedValue(3);

    await findOrCreateUser({ id: 'u6', email: 'f@g.com' });

    expect(seedCoursesForNewUser).not.toHaveBeenCalled();
    expect(existing.update).toHaveBeenCalledWith(expect.objectContaining({ coursesSeededAt: expect.any(Date) }));
  });

  it('stores null for name when not provided', async () => {
    const newUser = makeUser({ id: 'u7', email: 'g@h.com', name: null, coursesSeededAt: null });
    findOrCreate.mockResolvedValue([newUser, true]);

    await findOrCreateUser({ id: 'u7', email: 'g@h.com' });

    expect(findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: expect.objectContaining({ name: null }),
      }),
    );
  });
});
