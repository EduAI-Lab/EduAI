import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { SidebarProvider } from '@eduai/ui';
import { AppSiteHeader } from '~/components/layout/AppSiteHeader';
import { AuthProvider, type AuthUser } from '~/hooks/useLocalUser';
import { BugReportProvider } from '~/components/bug-report/BugReportProvider';

const { listAiModelsMock } = vi.hoisted(() => ({
  listAiModelsMock: vi.fn().mockResolvedValue([]),
}));

vi.mock('~/hooks/useAtPermissions', () => ({
  useAtPermissions: () => ({
    canSubmitBugReport: true,
    canCreateCourse: false,
    canBrowseEduAiCatalog: false,
    canImportFromEduAi: false,
    canManageContent: false,
    canPublishContent: false,
    canManageEnrollments: false,
    canAssignTaRole: false,
  }),
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

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light', setTheme: vi.fn() }),
}));

vi.mock('~/components/bug-report/BugReportDialog', () => ({
  BugReportDialog: () => null,
}));

async function renderHeader(path: string, user: AuthUser) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AuthProvider initialUser={user}>
      <BugReportProvider>{children}</BugReportProvider>
    </AuthProvider>
  );
  await act(async () => {
    render(
      <Wrapper>
        <MemoryRouter initialEntries={[path]}>
          <SidebarProvider>
            <AppSiteHeader />
          </SidebarProvider>
        </MemoryRouter>
      </Wrapper>,
    );
  });
}

describe('AppSiteHeader', () => {
  beforeEach(() => {
    listAiModelsMock.mockClear();
  });

  it('shows Report Bug for STUDENT', async () => {
    await renderHeader('/student', { id: 'u1', name: 'Student', role: 'STUDENT' });

    expect(screen.getByRole('button', { name: 'Report Bug' })).toBeInTheDocument();
  });

  it('shows Report Bug for INSTRUCTOR', async () => {
    await renderHeader('/instructor', { id: 'u2', name: 'Professor', role: 'INSTRUCTOR' });

    expect(screen.getByRole('button', { name: 'Report Bug' })).toBeInTheDocument();
  });

  it('shows EduAI Core cross-nav link for authenticated users', async () => {
    await renderHeader('/student', { id: 'u1', name: 'Student', role: 'STUDENT' });

    expect(screen.getByRole('link', { name: 'Open EduAI Core' })).toBeInTheDocument();
  });

  it('shows account menu for authenticated users', async () => {
    await renderHeader('/student', { id: 'u1', name: 'Student', role: 'STUDENT' });

    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
  });
});
