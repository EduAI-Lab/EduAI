/**
 * Unit tests for authService.findOrCreateUser without a real DB or network needed.
 * Mocks the Sequelize User model and seedCoursesForNewUser.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findOrCreate = vi.fn();
const seedCoursesForNewUser = vi.fn();

vi.mock('../../src/schema/index.js', () => ({
  User: { findOrCreate },
}));

vi.mock('../../src/services/seedNewUserService.js', () => ({
  seedCoursesForNewUser,
}));

const { findOrCreateUser } = await import('../../src/services/authService.js');

describe('findOrCreateUser', () => {
  beforeEach(() => {
    findOrCreate.mockReset();
    seedCoursesForNewUser.mockReset();
    seedCoursesForNewUser.mockResolvedValue(undefined);
  });

  it('returns the existing user when a local row already exists', async () => {
    const existing = { id: 'u1', email: 'a@b.com', name: 'Alice' };
    findOrCreate.mockResolvedValue([existing, false]);

    const result = await findOrCreateUser({ id: 'u1', email: 'a@b.com', name: 'Alice' });

    expect(result).toBe(existing);
    expect(seedCoursesForNewUser).not.toHaveBeenCalled();
  });

  it('creates a local user row when none exists', async () => {
    const newUser = { id: 'u2', email: 'b@c.com', name: 'Bob' };
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
    const newUser = { id: 'u3', email: 'c@d.com', name: 'Carol' };
    findOrCreate.mockResolvedValue([newUser, true]);

    await findOrCreateUser({ id: 'u3', email: 'c@d.com', name: 'Carol' });

    expect(seedCoursesForNewUser).toHaveBeenCalledWith('u3');
  });

  it('does not seed courses for returning users', async () => {
    const existing = { id: 'u4', email: 'd@e.com', name: 'Dave' };
    findOrCreate.mockResolvedValue([existing, false]);

    await findOrCreateUser({ id: 'u4', email: 'd@e.com', name: 'Dave' });

    expect(seedCoursesForNewUser).not.toHaveBeenCalled();
  });

  it('stores null for name when not provided', async () => {
    const newUser = { id: 'u5', email: 'e@f.com', name: null };
    findOrCreate.mockResolvedValue([newUser, true]);

    await findOrCreateUser({ id: 'u5', email: 'e@f.com' });

    expect(findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: expect.objectContaining({ name: null }),
      }),
    );
  });
});
