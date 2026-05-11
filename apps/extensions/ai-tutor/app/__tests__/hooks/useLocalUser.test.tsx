import { renderHook, act, waitFor } from '@testing-library/react';
import { render, screen } from '@testing-library/react';
import { AuthProvider, useLocalUser } from '~/hooks/useLocalUser';
import type { AuthUser } from '~/hooks/useLocalUser';

// Mock the api module
vi.mock('~/lib/api', () => ({
  default: {
    me: vi.fn().mockResolvedValue({ user: null }),
    logout: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

const testUser: AuthUser = { id: 'test-1', name: 'Test User', role: 'STUDENT' };

function makeWrapper(initialUser: AuthUser | null) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <AuthProvider initialUser={initialUser}>{children}</AuthProvider>;
  };
}

describe('useLocalUser', () => {
  it('throws when used outside AuthProvider', () => {
    // Suppress React error boundary console output
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useLocalUser());
    }).toThrow('useLocalUser must be used within an AuthProvider');

    spy.mockRestore();
  });

  it('returns context value when used inside AuthProvider', () => {
    const { result } = renderHook(() => useLocalUser(), {
      wrapper: makeWrapper(testUser),
    });

    expect(result.current.user).toEqual(testUser);
    expect(typeof result.current.saveAuth).toBe('function');
    expect(typeof result.current.logout).toBe('function');
    expect(typeof result.current.setUser).toBe('function');
  });
});

describe('AuthProvider', () => {
  it('renders children', () => {
    render(
      <AuthProvider initialUser={null}>
        <div data-testid="child">Hello</div>
      </AuthProvider>,
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toHaveTextContent('Hello');
  });

  it('with initialUser sets user immediately', () => {
    const { result } = renderHook(() => useLocalUser(), {
      wrapper: makeWrapper(testUser),
    });

    expect(result.current.user).toEqual(testUser);
  });

  it('with initialUser has isInitializing=false', () => {
    const { result } = renderHook(() => useLocalUser(), {
      wrapper: makeWrapper(testUser),
    });

    expect(result.current.isInitializing).toBe(false);
  });

  it('without initialUser starts with isInitializing=true', async () => {
    const { result } = renderHook(() => useLocalUser(), {
      wrapper: makeWrapper(null),
    });

    // Initially isInitializing is true (before the me() call resolves)
    expect(result.current.isInitializing).toBe(true);

    // Wait for the me() call to resolve and isInitializing to become false
    await waitFor(() => {
      expect(result.current.isInitializing).toBe(false);
    });
  });

  it('saveAuth updates the user', () => {
    const { result } = renderHook(() => useLocalUser(), {
      wrapper: makeWrapper(testUser),
    });

    const newUser: AuthUser = { id: 'test-2', name: 'New User', role: 'PROFESSOR' };

    act(() => {
      result.current.saveAuth(newUser);
    });

    expect(result.current.user).toEqual(newUser);
  });

  it('logout sets user to null', async () => {
    const { result } = renderHook(() => useLocalUser(), {
      wrapper: makeWrapper(testUser),
    });

    expect(result.current.user).toEqual(testUser);

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.user).toBeNull();
  });

  it('after logout, user is null and can saveAuth again', async () => {
    const { result } = renderHook(() => useLocalUser(), {
      wrapper: makeWrapper(testUser),
    });

    // Logout first
    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.user).toBeNull();

    // Save a new user after logout
    const newUser: AuthUser = { id: 'test-3', name: 'Another User', role: 'TA' };

    act(() => {
      result.current.saveAuth(newUser);
    });

    expect(result.current.user).toEqual(newUser);
  });
});
