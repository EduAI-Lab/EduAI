import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useAuth = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuth(),
}));

vi.mock('@/components/layout/QmAppLayout', () => ({
  QmAccessShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import { QmAppGate } from '@/components/auth/QmAppGate';

describe('Question Maker authentication outage', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({
      user: null,
      isLoading: false,
      authError: 'Authentication service unavailable',
    });
  });

  it('shows a recoverable outage instead of redirecting or spinning forever', () => {
    render(
      <QmAppGate>
        <p>private content</p>
      </QmAppGate>,
    );

    expect(screen.getByRole('heading', { name: 'Authentication service unavailable' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(screen.queryByText('private content')).not.toBeInTheDocument();
  });
});
