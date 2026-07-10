import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import {
  AppShell,
  AIServiceIndicators,
  BugReportDialog,
  Button,
  CommandSearchButton,
  ThemeToggle,
  useAiServiceStatus,
  type BugReportSubmitData,
} from '@eduai/ui';
import { IconBooks, IconBug, IconHelpCircle, IconReport, IconSettings } from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';

import api from '~/lib/api';
import { useLocalUser } from '~/hooks/useLocalUser';
import { getNavForUser } from '~/lib/rbac/nav';
import type { AtNavItemKey } from '~/lib/rbac/types';
import { routeForRole } from '~/lib/role-routing';
import { CURRENT_APP_ID, getLauncherApps } from '~/lib/apps';
import { CommandPalette, AITUTOR_COMMAND_EVENT } from '~/components/command/CommandPalette';
import { useBugReport } from '~/components/bug-report/useBugReport';
import { ShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbs';
import {
  ShellBreadcrumbProvider,
  useShellBreadcrumbState,
} from '~/components/layout/ShellBreadcrumbContext';
import TourButton from '~/components/TourButton';

const NAV_ICONS: Record<AtNavItemKey, Icon> = {
  'my-courses': IconBooks,
  teaching: IconBooks,
  'admin-courses': IconBooks,
  'admin-bug-reports': IconReport,
  enrollments: IconBooks,
  analytics: IconBooks,
};

/** AI Tutor brand mark, unchanged from the old sidebar — mirrors QM's `qmLogo` block. */
const AI_TUTOR_LOGO = (
  <>
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
      style={{ background: 'var(--primary)' }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="1.75"
        strokeLinecap="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 1 0 18" />
        <path d="M3 12h18" />
      </svg>
    </div>
    <div className="flex flex-col leading-none">
      <span className="text-sm font-bold tracking-tight">AI Tutor</span>
      <span className="text-[10px] font-medium uppercase tracking-widest text-sidebar-foreground/60">
        EduAI
      </span>
    </div>
  </>
);

/** Reads the active route's published breadcrumb trail (see ShellBreadcrumbContext). */
function HeaderBreadcrumbs() {
  const items = useShellBreadcrumbState();
  return <ShellBreadcrumbs items={items} />;
}

function AppLayoutInner() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useLocalUser();
  const { captureScreenshot, getCapturedData, context } = useBugReport();
  const aiStatus = useAiServiceStatus({ fetcher: () => api.aiStatus() });
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const [capturingScreenshot, setCapturingScreenshot] = useState(false);

  // All hooks above run unconditionally (rules of hooks) — everything below
  // may branch. Bare `<Outlet />` while `!user` matches the old per-route
  // `<AppShell>`'s behavior: the route's own `clientLoader` has already
  // confirmed a session via `requireClientUser`, but `useLocalUser()`'s local
  // `/api/me` state can briefly still be initializing when this first renders.
  if (!user) {
    return <Outlet />;
  }

  const handleOpenBugReport = async () => {
    setCapturingScreenshot(true);
    try {
      await captureScreenshot();
      setBugReportOpen(true);
    } finally {
      setCapturingScreenshot(false);
    }
  };

  const handleSubmitBugReport = async (data: BugReportSubmitData) => {
    await api.submitBugReport({
      description: data.description,
      bugType: data.bugType,
      isAnonymous: data.isAnonymous,
      consoleLogs: data.consoleLogs ?? '[]',
      networkLogs: data.networkLogs ?? '[]',
      screenshot: data.screenshot ?? null,
      pageUrl: data.pageUrl ?? window.location.href,
      userAgent: data.userAgent ?? navigator.userAgent,
      context,
    });
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const navMain = getNavForUser(user).map((item) => ({
    title: item.title,
    url: item.href,
    icon: NAV_ICONS[item.key],
  }));

  return (
    <AppShell
      sidebar={{
        logo: AI_TUTOR_LOGO,
        logoHref: routeForRole(user.role),
        navMain,
        navSecondary: [{ title: 'Help', url: '/help', icon: IconHelpCircle }],
        currentPath: pathname,
        LinkComponent: Link,
        launcher: { apps: getLauncherApps(), currentAppId: CURRENT_APP_ID, role: user.role },
        user: { name: user.name, email: user.email ?? '', role: user.role },
        navUser: {
          items: [
            {
              label: 'Settings',
              href: '/settings',
              icon: <IconSettings size={15} strokeWidth={1.75} />,
            },
          ],
          LinkComponent: Link,
          onLogout: handleLogout,
        },
      }}
      breadcrumbs={<HeaderBreadcrumbs />}
      headerActions={
        <>
          <CommandSearchButton eventName={AITUTOR_COMMAND_EVENT} />
          <AIServiceIndicators cloud={aiStatus.cloud} ubc={aiStatus.ubc} onRefresh={aiStatus.refresh} />
          <TourButton />
          <ThemeToggle className="size-9 min-h-9 min-w-9" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleOpenBugReport()}
            disabled={capturingScreenshot}
          >
            <IconBug className="mr-1 h-4 w-4" aria-hidden="true" />
            {capturingScreenshot ? 'Preparing…' : 'Report a bug'}
          </Button>
        </>
      }
      commandPalette={
        <>
          <CommandPalette />
          <BugReportDialog
            open={bugReportOpen}
            onOpenChange={setBugReportOpen}
            onSubmit={handleSubmitBugReport}
            captureScreenshot={captureScreenshot}
            getCapturedData={getCapturedData}
          />
        </>
      }
    >
      <Outlet />
    </AppShell>
  );
}

/**
 * Authenticated app chrome: shared `@eduai/ui` `AppShell`, mounted as a
 * single layout route (issue #764) instead of AI Tutor's old forked
 * per-route `<AppShell>` composition. Structured like QM's
 * `QmAppLayout` → `QmAppLayoutInner` split so `ShellBreadcrumbProvider`
 * always wraps `<Outlet />` (both the pre-auth and authenticated states),
 * which keeps `useShellBreadcrumbs` safe to call from every child route.
 */
export default function AppLayout() {
  return (
    <ShellBreadcrumbProvider>
      <AppLayoutInner />
    </ShellBreadcrumbProvider>
  );
}
