import { redirect } from 'react-router';
import api from '~/lib/api';
import type { Role, User } from '~/lib/types';

/**
 * Last-known authenticated user, seeded from `AuthProvider` / `useLocalUser`
 * so clientLoaders can skip a redundant `/api/me` on every navigation (#1334).
 * Cleared on logout. Never treated as a security boundary — API routes still
 * authorize server-side; this only avoids re-probing the session for the
 * client-side role gate.
 */
let seededUser: User | null = null;

export function seedClientUser(
  user: Pick<User, 'id' | 'name' | 'role'> & {
    email?: string;
    authorizedUnits?: string[];
  } | null,
): void {
  seededUser = user
    ? {
        id: user.id,
        name: user.name,
        email: user.email ?? '',
        role: user.role,
        authorizedUnits: user.authorizedUnits ?? [],
      }
    : null;
}

export function clearClientUserSeed(): void {
  seededUser = null;
}

function assertRoleAllowed(user: User, role?: Role | Role[]): void {
  if (!role) return;
  const allowed = Array.isArray(role) ? role : [role];
  if (!allowed.includes(user.role)) throw redirect('/');
}

export async function requireClientUser(role?: Role | Role[]): Promise<User> {
  try {
    if (seededUser) {
      assertRoleAllowed(seededUser, role);
      return seededUser;
    }

    const { user } = await api.me();
    if (!user) throw redirect('/');
    assertRoleAllowed(user, role);
    seedClientUser(user);
    return user;
  } catch (err) {
    // Preserve intentional redirects; anything else (network, unexpected) still
    // bounces to `/` so unauthenticated callers can't proceed.
    if (err instanceof Response) throw err;
    throw redirect('/');
  }
}
