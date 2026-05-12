import { redirect } from 'react-router';
import type { Role, User } from '~/lib/types';

const API_BASE = process.env.VITE_API_URL || 'http://localhost:4000';

function buildHeaders(request: Request, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  const cookie = request.headers.get('cookie');
  if (cookie && !headers.has('cookie')) {
    headers.set('cookie', cookie);
  }
  if (!headers.has('content-type') && init?.body && typeof init.body === 'string') {
    headers.set('content-type', 'application/json');
  }
  return headers;
}

async function requestApi(request: Request, path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const headers = buildHeaders(request, init);
  const response = await fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  });
  return response;
}

export async function fetchJson<T = unknown>(
  request: Request,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await requestApi(request, path, init);
  if (!response.ok) {
    throw response;
  }

  return response.json() as Promise<T>;
}

export async function loadUserFromRequest(request: Request): Promise<User | null> {
  try {
    const data = await fetchJson<{ user: User | null }>(request, '/api/me');
    return data.user ?? null;
  } catch (error) {
    if (error instanceof Response) {
      if (error.status === 404 || error.status === 401 || error.status === 403) {
        return null;
      }
      throw error;
    }
    return null;
  }
}

export async function requireUserFromRequest(request: Request, role?: Role): Promise<User> {
  const response = await requestApi(request, '/api/me');
  if (response.status === 401 || response.status === 403) {
    throw redirect('/');
  }
  if (!response.ok) {
    throw response;
  }
  const data = (await response.json()) as { user: User | null };
  const user = data.user;
  if (!user) throw redirect('/');
  if (role && user.role !== role) {
    throw redirect('/');
  }
  return user;
}
