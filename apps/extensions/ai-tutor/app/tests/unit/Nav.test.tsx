import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import Nav from '~/components/Nav';
import { AuthProvider, type AuthUser } from '~/hooks/useLocalUser';
import { BugReportProvider } from '~/components/bug-report/BugReportProvider';

const { listAiModelsMock } = vi.hoisted(() => ({
  listAiModelsMock: vi.fn().mockResolvedValue([]),
}));

vi.mock('~/hooks/useBugReportCapture', () => ({
  useBugReportCapture: () => ({
    captureScreenshot: vi.fn().mockResolvedValue(null),
    getCapturedData: vi.fn().mockReturnValue({
      consoleLogs: '[]',
      networkLogs: '[]',
      screenshot: null,
    }),
  }),
}));

vi.mock('~/lib/api', () => ({
  api: {
    listAiModels: listAiModelsMock,
  },
  default: {
    me: vi.fn().mockResolvedValue({ user: null }),
    logout: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

vi.mock('~/components/TourButton', () => ({
  default: () => null,
}));

vi.mock('~/components/bug-report/BugReportDialog', () => ({
  BugReportDialog: () => null,
}));

async function renderNav(path: string, user: AuthUser) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider initialUser={user}>
      <BugReportProvider>{children}</BugReportProvider>
    </AuthProvider>
  );
  await act(async () => {
    render(
      <Wrapper>
        <MemoryRouter initialEntries={[path]}>
          <Nav />
        </MemoryRouter>
      </Wrapper>,
    );
  });
}

describe('Nav', () => {
  beforeEach(() => {
    listAiModelsMock.mockClear();
  });

  it('shows Report Bug for STUDENT', async () => {
    await renderNav('/student', { id: 'u1', name: 'Student', role: 'STUDENT' });

    expect(screen.getByRole('button', { name: 'Report Bug' })).toBeInTheDocument();
  });

  it('shows Report Bug for INSTRUCTOR', async () => {
    await renderNav('/instructor', { id: 'u2', name: 'Professor', role: 'INSTRUCTOR' });

    expect(screen.getByRole('button', { name: 'Report Bug' })).toBeInTheDocument();
  });

  it('hides Report Bug for ADMIN', async () => {
    await renderNav('/admin', { id: 'u3', name: 'Admin', role: 'ADMIN' });

    expect(screen.queryByRole('button', { name: 'Report Bug' })).not.toBeInTheDocument();
  });
});
