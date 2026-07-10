import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import {
  AppShell,
  AIServiceIndicators,
  Badge,
  BugReportDialog,
  Button,
  CommandSearchButton,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ThemeToggle,
  useAiServiceStatus,
  type BugReportSubmitData,
} from '@eduai/ui';
import {
  IconBell,
  IconBooks,
  IconBug,
  IconDashboard,
  IconHelpCircle,
  IconMessageChatbot,
  IconSettings,
  IconShieldLock,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';

import api, { type NotificationCounts } from '~/lib/api';
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
  dashboard: IconDashboard,
  'my-courses': IconBooks,
  teaching: IconBooks,
  'admin-courses': IconBooks,
  'admin-bug-reports': IconShieldLock,
  enrollments: IconBooks,
  analytics: IconBooks,
};

// Matches the 60s interval `useAiServiceStatus` (packages/ui) already polls
// AI-service status on in this same header — kept in step rather than
// introducing a second cadence.
const NOTIFICATION_POLL_MS = 60_000;

interface NotificationRow {
  key: string;
  value: number;
  label: string;
  href: string;
}

/**
 * Label + destination for the notification-count fields the backend is
 * known to send today. `NotificationCounts` fields are role-dependent and
 * possibly absent — anything not listed here still renders (see
 * `humanizeCountKey`) so a future field never gets silently dropped.
 */
const NOTIFICATION_COUNT_META: Record<string, (n: number) => { label: string; href: string }> = {
  ungradedSubmissions: (n) => ({
    label: `${n} submission${n === 1 ? '' : 's'} to review`,
    // No single course is implied by the aggregate count — the dashboard
    // is the one place that already surfaces pending submissions per role.
    href: '/dashboard',
  }),
  unhandledBugReports: (n) => ({
    label: `${n} open bug report${n === 1 ? '' : 's'}`,
    href: '/admin',
  }),
  unread: (n) => ({
    label: `${n} unread notification${n === 1 ? '' : 's'}`,
    href: '/dashboard',
  }),
};

/** camelCase → "camel case" fallback for any count field with no entry above. */
function humanizeCountKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

/** True once the payload has at least one role-relevant count field (`total`
 * doesn't count) — used to hide the bell entirely when nothing applies. */
function hasApplicableCounts(counts: NotificationCounts | null): boolean {
  if (!counts) return false;
  return Object.keys(counts).some((key) => key !== 'total' && typeof counts[key] === 'number');
}

/** Non-zero rows to list in the popover, sorted largest-first. */
function buildNotificationRows(counts: NotificationCounts): NotificationRow[] {
  return Object.entries(counts)
    .filter(
      (entry): entry is [string, number] =>
        entry[0] !== 'total' && typeof entry[1] === 'number' && entry[1] > 0,
    )
    .map(([key, value]) => {
      const meta = NOTIFICATION_COUNT_META[key]?.(value);
      return meta
        ? { key, value, ...meta }
        : { key, value, label: `${value} ${humanizeCountKey(key)}`, href: '/dashboard' };
    })
    .sort((a, b) => b.value - a.value);
}

/**
 * AI Tutor brand mark — canonical shape shared with Core (`app-sidebar.tsx`)
 * and QM (`qmLogo`): a 28×28 inline-sized `--primary` tile holding the app's
 * launcher-registry icon, plus a single `text-base font-bold` wordmark. No
 * stacked subtitle — that two-line variant was unique to AI Tutor.
 */
const AI_TUTOR_LOGO = (
  <>
    <div
      className="flex shrink-0 items-center justify-center"
      style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--primary)' }}
    >
      <IconMessageChatbot className="size-4 text-white" strokeWidth={1.75} aria-hidden />
    </div>
    <span className="text-base font-bold" style={{ letterSpacing: '-0.01em' }}>
      AI Tutor
    </span>
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
  const [notificationCounts, setNotificationCounts] = useState<NotificationCounts | null>(null);

  // Polls `api.notificationCounts()` the same way `useAiServiceStatus` above
  // polls AI status: fetch on mount, then on an interval, swallowing errors
  // so a flaky endpoint hides the bell instead of crashing the shell.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await api.notificationCounts();
        if (!cancelled) setNotificationCounts(result);
      } catch {
        if (!cancelled) setNotificationCounts(null);
      }
    };
    void load();
    const timer = setInterval(load, NOTIFICATION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

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

  const showNotificationsBell = hasApplicableCounts(notificationCounts);
  const notificationRows = notificationCounts ? buildNotificationRows(notificationCounts) : [];
  const notificationTotal =
    typeof notificationCounts?.total === 'number'
      ? notificationCounts.total
      : notificationRows.reduce((sum, row) => sum + row.value, 0);

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
          {showNotificationsBell && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="relative size-9 min-h-9 min-w-9"
                  aria-label={
                    notificationTotal > 0
                      ? `Notifications, ${notificationTotal} unread`
                      : 'Notifications'
                  }
                >
                  <IconBell className="h-4 w-4" aria-hidden="true" />
                  {notificationTotal > 0 && (
                    <Badge
                      variant="destructive"
                      size="sm"
                      className="pointer-events-none absolute -right-1 -top-1 h-[18px] min-w-[18px] justify-center px-1"
                    >
                      {notificationTotal > 9 ? '9+' : notificationTotal}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {notificationRows.length === 0 ? (
                  <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                    You&rsquo;re all caught up
                  </div>
                ) : (
                  notificationRows.map((row) => (
                    <DropdownMenuItem key={row.key} asChild>
                      <Link to={row.href}>{row.label}</Link>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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
