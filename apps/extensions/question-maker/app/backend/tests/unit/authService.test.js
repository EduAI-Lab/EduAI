/**
 * Unit tests for authService.findOrCreateUser without a real DB or network needed.
 * Mocks the Prisma client only — no demo-course seeding happens on the
 * login path anymore (see tests/helpers/seedCoursesFixture.js for the retired
 * seeding logic, now a test-only fixture).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const upsert = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: { user: { upsert } },
}));

const { findOrCreateUser } = await import('../../src/services/authService.js');

describe('findOrCreateUser', () => {
  beforeEach(() => {
    upsert.mockReset();
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
