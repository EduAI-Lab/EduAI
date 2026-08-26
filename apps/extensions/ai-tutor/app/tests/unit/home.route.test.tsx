import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';

const mockNavigate = vi.fn();
vi.mock('react-router', async (importActual) => {
  const actual = await importActual<typeof import('react-router')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

let mockUser: { role: string } | null = null;
let mockIsInitializing = true;
vi.mock('~/hooks/useLocalUser', () => ({
  useLocalUser: () => ({ user: mockUser, isInitializing: mockIsInitializing }),
}));

const mockRouteForRole = vi.fn().mockReturnValue('/dashboard');
vi.mock('~/lib/role-routing', () => ({
  routeForRole: (...args: unknown[]) => mockRouteForRole(...args),
}));

const mockGetCoreLoginUrl = vi.fn().mockReturnValue('https://core.example.com/login');
vi.mock('~/lib/coreUrl', () => ({
  getCoreLoginUrl: (...args: unknown[]) => mockGetCoreLoginUrl(...args),
}));

import Home from '~/routes/home';

describe('home route', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockRouteForRole.mockClear();
    mockGetCoreLoginUrl.mockClear();
    mockUser = null;
    mockIsInitializing = true;
    // @ts-expect-error jsdom navigation stub
    delete window.location;
    window.location = { href: '' } as Location;
  });

  it('does nothing while still initializing and no user yet', () => {
    mockIsInitializing = true;
    mockUser = null;
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(window.location.href).toBe('');
  });

  it('redirects to the role home once a user is present', async () => {
    mockIsInitializing = false;
    mockUser = { role: 'STUDENT' };
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true }));
    expect(mockRouteForRole).toHaveBeenCalledWith('STUDENT');
  });

  it('falls back to the Core login page once initialization settles with no user', async () => {
    mockIsInitializing = false;
    mockUser = null;
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );

    await waitFor(() => expect(window.location.href).toBe('https://core.example.com/login'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
