import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';

const mockNavigate = vi.fn();
vi.mock('react-router', async (importActual) => {
  const actual = await importActual<typeof import('react-router')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockLogout = vi.fn().mockResolvedValue(undefined);
let mockUser: { role: string } | null = { role: 'GUEST' };
vi.mock('~/hooks/useLocalUser', () => ({
  useLocalUser: () => ({ user: mockUser, logout: mockLogout }),
}));

const mockRouteForRole = vi.fn().mockReturnValue('/dashboard');
vi.mock('~/lib/role-routing', () => ({
  routeForRole: (...args: unknown[]) => mockRouteForRole(...args),
}));

import UnsupportedRolePage from '~/routes/unsupported-role';

describe('unsupported-role route', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockLogout.mockClear();
    mockRouteForRole.mockClear();
  });

  it('redirects home immediately when there is no user', async () => {
    mockUser = null;
    render(
      <MemoryRouter>
        <UnsupportedRolePage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }));
  });

  it('redirects a recognized role to its home route', async () => {
    mockUser = { role: 'STUDENT' };
    render(
      <MemoryRouter>
        <UnsupportedRolePage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true }),
    );
    expect(mockRouteForRole).toHaveBeenCalledWith('STUDENT');
  });

  it('shows the role in the explanation copy', () => {
    mockUser = { role: 'GUEST' };
    render(
      <MemoryRouter>
        <UnsupportedRolePage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/GUEST/)).toBeInTheDocument();
  });

  it('signing out logs out then navigates home', async () => {
    mockUser = { role: 'GUEST' };
    render(
      <MemoryRouter>
        <UnsupportedRolePage />
      </MemoryRouter>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    });

    expect(mockLogout).toHaveBeenCalled();
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenLastCalledWith('/', { replace: true }),
    );
  });
});
