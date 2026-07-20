/**
 * Unit tests for authService.findOrCreateUser without a real DB or network needed.
 * Mocks the Sequelize User model only — no demo-course seeding happens on the
 * login path anymore (see tests/helpers/seedCoursesFixture.js for the retired
 * seeding logic, now a test-only fixture).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findOrCreate = vi.fn();

vi.mock('../../src/schema/index.js', () => ({
  User: { findOrCreate },
}));

const { findOrCreateUser } = await import('../../src/services/authService.js');

function makeUser(overrides = {}) {
  return {
    id: 'u1',
    email: 'a@b.com',
    name: 'Alice',
    update: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('findOrCreateUser', () => {
  beforeEach(() => {
    findOrCreate.mockReset();
  });

  it('returns the existing user when a local row already exists', async () => {
    const existing = makeUser({ id: 'u1', email: 'a@b.com', name: 'Alice' });
    findOrCreate.mockResolvedValue([existing, false]);

    const result = await findOrCreateUser({ id: 'u1', email: 'a@b.com', name: 'Alice' });

    expect(result).toBe(existing);
  });

  it('creates a local user row when none exists', async () => {
    const newUser = makeUser({ id: 'u2', email: 'b@c.com', name: 'Bob' });
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

  it('stores null for name when not provided', async () => {
    const newUser = makeUser({ id: 'u7', email: 'g@h.com', name: null });
    findOrCreate.mockResolvedValue([newUser, true]);

    await findOrCreateUser({ id: 'u7', email: 'g@h.com' });

    expect(findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        defaults: expect.objectContaining({ name: null }),
      }),
    );
  });
});
