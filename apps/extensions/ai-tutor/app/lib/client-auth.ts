import { redirect } from 'react-router';
import api from '~/lib/api';
import type { Role, User } from '~/lib/types';

export async function requireClientUser(role?: Role): Promise<User> {
  try {
    const { user } = await api.me();
    if (!user) throw redirect('/');
    if (role && user.role !== role) throw redirect('/');
    return user;
  } catch {
    throw redirect('/');
  }
}
