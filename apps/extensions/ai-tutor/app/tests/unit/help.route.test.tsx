import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

const mockRequireClientUser = vi.fn().mockResolvedValue({ id: 'u1', role: 'STUDENT' });
vi.mock('~/lib/client-auth', () => ({
  requireClientUser: (...args: unknown[]) => mockRequireClientUser(...args),
}));

const mockUseShellBreadcrumbs = vi.fn();
vi.mock('~/components/layout/ShellBreadcrumbContext', () => ({
  useShellBreadcrumbs: (...args: unknown[]) => mockUseShellBreadcrumbs(...args),
  ShellBreadcrumbContext: {},
}));

vi.mock('~/hooks/useLocalUser', () => ({
  useLocalUser: () => ({ user: { id: 'u1', name: 'Student', role: 'STUDENT' } }),
}));

vi.mock('~/components/help/HelpView', () => ({
  HelpView: ({ role }: { role?: string }) => <div data-testid="help-view">role: {role}</div>,
}));

import HelpPage, { clientLoader } from '~/routes/help';

describe('help route', () => {
  it('requires an authenticated user in the loader', async () => {
    await clientLoader({} as never);
    expect(mockRequireClientUser).toHaveBeenCalled();
  });

  it('publishes a Help breadcrumb and passes the user role through', () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>,
    );

    expect(mockUseShellBreadcrumbs).toHaveBeenCalledWith([{ label: 'Help' }]);
    expect(screen.getByTestId('help-view')).toHaveTextContent('role: STUDENT');
  });
});
