/**
 * #1334: `requireClientUser` must not force a fresh `/api/me` on every
 * clientLoader navigation when AuthProvider already knows the user.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const me = vi.fn();
vi.mock('~/lib/api', () => ({ default: { me: (...a: unknown[]) => me(...a) } }));
vi.mock('react-router', () => ({
  redirect: (to: string) => {
    const err = new Error(`redirect:${to}`);
    (err as Error & { status: number }).status = 302;
    throw err;
  },
}));

describe('requireClientUser (#1334)', () => {
  beforeEach(() => {
    me.mockReset();
    vi.resetModules();
  });

  it('uses a seeded user without calling api.me', async () => {
    const { seedClientUser, requireClientUser, clearClientUserSeed } = await import(
      '~/lib/client-auth'
    );
    clearClientUserSeed();
    seedClientUser({
      id: 'u1',
      name: 'Student',
      role: 'STUDENT',
      authorizedUnits: [],
    });

    const user = await requireClientUser(['STUDENT', 'TA']);

    expect(user).toMatchObject({ id: 'u1', role: 'STUDENT' });
    expect(me).not.toHaveBeenCalled();
    clearClientUserSeed();
  });

  it('falls back to api.me when no seed is present', async () => {
    const { requireClientUser, clearClientUserSeed } = await import('~/lib/client-auth');
    clearClientUserSeed();
    me.mockResolvedValue({
      user: { id: 'u2', name: 'Prof', role: 'INSTRUCTOR', authorizedUnits: [] },
    });

    const user = await requireClientUser(['INSTRUCTOR', 'ADMIN']);

    expect(user).toMatchObject({ id: 'u2', role: 'INSTRUCTOR' });
    expect(me).toHaveBeenCalledTimes(1);
  });

  it('rejects a seeded user whose role is not allowed', async () => {
    const { seedClientUser, requireClientUser, clearClientUserSeed } = await import(
      '~/lib/client-auth'
    );
    clearClientUserSeed();
    seedClientUser({
      id: 'u3',
      name: 'Student',
      role: 'STUDENT',
      authorizedUnits: [],
    });

    await expect(requireClientUser(['INSTRUCTOR'])).rejects.toThrow(/redirect:\//);
    expect(me).not.toHaveBeenCalled();
    clearClientUserSeed();
  });
});
