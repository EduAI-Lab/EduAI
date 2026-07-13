import { type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { Outlet } from 'react-router';
import {
  AppShell,
  ThemeToggle,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbLink,
  BreadcrumbSeparator,
  Button,
  CommandSearchButton,
  AIServiceIndicators,
} from '@eduai/ui';
import {
  IconBooks,
  IconBug,
  IconDashboard,
  IconLibrary,
  IconSettings,
  IconHelpCircle,
  IconRoute,
  type Icon,
} from '@tabler/icons-react';
import { useAuth } from '@/contexts/AuthContext';
import { useQmLayout, QmLayoutProvider } from '@/components/layout/QmLayoutContext';
import { ProfileCoursesDialog } from '@/components/profile/ProfileCoursesDialog';
import { useCourses } from '@/hooks/useCourses';
import { useAiServicesStatus } from '@/hooks/useAiServicesStatus';
import { useGuidedTour } from '@/contexts/GuidedTourContext';
import { useBugReport } from '@/contexts/BugReportContext';
import { Tooltip } from '@/components/ui/tooltip';
import { CourseSwitcher } from '@/components/layout/CourseSwitcher';
import { CommandPalette } from '@/components/command/CommandPalette';
import { CURRENT_APP_ID, getLauncherApps } from '@/lib/apps';

const ROUTE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/courses': 'Courses',
  '/library': 'Question Library',
  '/settings': 'Settings',
  '/help': 'Help',
  '/admin/bug-reports': 'Bug reports',
};

function resolveTitle(pathname: string): string {
  if (pathname.startsWith('/courses/') && pathname !== '/courses') {
    return 'Course workspace';
  }
  return ROUTE_TITLES[pathname] ?? 'Question Maker';
}

/**
 * Route-aware breadcrumb: a real trail for the course workspace (with an inline
 * course switcher) and a single page label everywhere else. Deep routes (composer,
 * builder, variants) add a third crumb; on a workspace tab the tab bar shows it.
 */
function WorkspaceBreadcrumb({ pathname, tab }: { pathname: string; tab: string | null }) {
  const courseMatch = pathname.match(/^\/courses\/(\d+)/);
  const courseId = courseMatch ? Number(courseMatch[1]) : null;

  if (!courseId) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>{resolveTitle(pathname)}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  let sub: string | null = null;
  if (/\/questions\/new$/.test(pathname)) sub = 'New question';
  else if (/\/questions\/[^/]+\/edit$/.test(pathname)) sub = 'Edit question';
  else if (/\/questions\/[^/]+\/variant$/.test(pathname)) sub = 'New variant';
  else if (/\/assessments\/[^/]+\/variants$/.test(pathname)) sub = 'Variants';
  else if (/\/assessments\/[^/]+$/.test(pathname)) sub = 'Assessment builder';

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/courses">Courses</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <CourseSwitcher courseId={courseId} />
        </BreadcrumbItem>
        {sub && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{sub}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

type NavItemKey =
  | 'dashboard'
  | 'courses'
  | 'library'
  | 'help';

const NAV_ICONS: Record<NavItemKey, Icon> = {
  dashboard: IconDashboard,
  courses: IconBooks,
  library: IconLibrary,
  help: IconHelpCircle,
};

interface NavItem {
  key: NavItemKey;
  title: string;
  href: string;
  external?: boolean;
}

function getNavForUser(user: { role: string } | null): NavItem[] {
  if (!user) return [];
  return [
    { key: 'dashboard', title: 'Dashboard', href: '/dashboard' },
    { key: 'courses', title: 'Courses', href: '/courses' },
    { key: 'library', title: 'Question Library', href: '/library' },
  ];
}

function getNavSecondaryForUser(user: { role: string } | null): NavItem[] {
  if (!user) return [];
  // Settings lives in the navUser dropdown (like Core).
  // Bug reports is in the site-header top actions (like Core).
  // Cross-app navigation (EduAI Core + other extensions) lives in the
  // footer AppSwitcher. Secondary nav only has Help.
  return [
    { key: 'help', title: 'Help', href: '/help' },
  ];
}

/** QM brand mark shown in the sidebar header (and the AppSidebar app switcher trigger). */
const qmLogo = (
  <>
    <div
      className="flex shrink-0 items-center justify-center"
      style={{
        width: 28,
        height: 28,
        borderRadius: 7,
        background: 'var(--primary)',
      }}
    >
      <IconBooks className="size-4 text-[var(--gold)]" strokeWidth={1.75} />
    </div>
    <span className="text-base font-bold" style={{ letterSpacing: '-0.01em' }}>Question Maker</span>
  </>
);

function QmAppLayoutInner() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const { user, logout } = useAuth();
  const { profileOpen, closeProfile, guidedTourHandler } = useQmLayout();
  const { courses, isLoading: isCoursesLoading, fetchCourses } = useCourses();
  const aiStatus = useAiServicesStatus();
  const { startTour } = useGuidedTour();
  const bugReport = useBugReport();

  const handleGuidedTourClick = () => {
    if (guidedTourHandler) {
      guidedTourHandler();
    } else {
      startTour('main');
    }
  };

  const navMain = getNavForUser(user ? { role: user.role } : null).map((item) => ({
    title: item.title,
    url: item.href,
    icon: NAV_ICONS[item.key],
    external: item.external,
  }));

  const navSecondary = getNavSecondaryForUser(user ? { role: user.role } : null).map((item) => ({
    title: item.title,
    url: item.href,
    icon: NAV_ICONS[item.key],
    external: item.external,
  }));

  // The question composer relies on a page-level sticky action bar. AppShell's
  // default `<main>` is `overflow-auto`, which makes it the sticky containing
  // block — but it never actually scrolls (the document does), so any sticky
  // child is trapped and scrolls away instead of pinning below the header.
  // Drop `overflow-auto` on the composer routes so the bar sticks to the
  // viewport; main clips nothing here anyway.
  const isComposerRoute =
    pathname.endsWith('/questions/new') || /\/questions\/[^/]+\/edit$/.test(pathname);

  return (
    <AppShell
      mainClassName={isComposerRoute ? 'min-w-0 flex-1' : undefined}
      sidebar={{
        logo: qmLogo,
        logoHref: '/dashboard',
        navMain,
        navSecondary,
        currentPath: pathname,
        LinkComponent: Link,
        launcher: { apps: getLauncherApps(), currentAppId: CURRENT_APP_ID, role: user?.role },
        user: user
          ? { name: user.name ?? user.email, email: user.email, image: user.image, role: user.role }
          : { name: 'Guest', email: '', role: 'GUEST' },
        navUser: user
          ? {
              items: [
                {
                  label: 'Settings',
                  href: '/settings',
                  icon: <IconSettings size={15} strokeWidth={1.75} />,
                },
              ],
              LinkComponent: Link,
              onLogout: logout,
            }
          : undefined,
      }}
      title={resolveTitle(pathname)}
      breadcrumbs={<WorkspaceBreadcrumb pathname={pathname} tab={searchParams.get('tab')} />}
      headerActions={
        <>
          <CommandSearchButton eventName="qm:open-command" />
          <div data-tour-id="eduai-status">
            <AIServiceIndicators
              cloud={aiStatus.cloud}
              ubc={aiStatus.ubc}
              onRefresh={() => void aiStatus.refresh()}
            />
          </div>
          <div className="relative">
            <Tooltip content="Walk through the app with a guided tour" side="bottom">
              <Button variant="ghost" size="icon" className="size-9" onClick={handleGuidedTourClick} aria-label="Guided tour">
                <IconRoute className="size-4" />
              </Button>
            </Tooltip>
            {courses.length === 0 && !isCoursesLoading && (
              <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
              </span>
            )}
          </div>
          <ThemeToggle className="size-9 min-h-9 min-w-9" />
          {bugReport ? (
            <Button variant="outline" size="sm" onClick={bugReport.openBugReport}>
              <IconBug className="h-4 w-4 mr-1" />
              Report a bug
            </Button>
          ) : null}
        </>
      }
      commandPalette={
        <>
          <CommandPalette />
          <ProfileCoursesDialog
            open={profileOpen}
            onClose={closeProfile}
            existingCourses={courses}
            onCoursesAdded={fetchCourses}
          />
        </>
      }
    >
      <Outlet />
    </AppShell>
  );
}

export function QmAppLayout() {
  return (
    <QmLayoutProvider>
      <QmAppLayoutInner />
    </QmLayoutProvider>
  );
}

/** Sidebar shell for access-denied and other minimal states. */
export function QmAccessShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  const navMain = getNavForUser(user ? { role: user.role } : null).map((item) => ({
    title: item.title,
    url: item.href,
    icon: NAV_ICONS[item.key],
    external: item.external,
  }));

  const navSecondary = getNavSecondaryForUser(user ? { role: user.role } : null).map((item) => ({
    title: item.title,
    url: item.href,
    icon: NAV_ICONS[item.key],
    external: item.external,
  }));

  return (
    <QmLayoutProvider>
      <AppShell
        sidebar={{
          logo: qmLogo,
          logoHref: '/dashboard',
          navMain,
          navSecondary,
          currentPath: '/',
          LinkComponent: Link,
          launcher: { apps: getLauncherApps(), currentAppId: CURRENT_APP_ID, role: user?.role },
          user: user
            ? { name: user.name ?? user.email, email: user.email, image: user.image, role: user.role }
            : { name: 'Guest', email: '', role: 'GUEST' },
          navUser: user ? { items: [], onLogout: logout } : undefined,
        }}
        title="Question Maker"
      >
        <div className="flex h-full items-center justify-center p-4">{children}</div>
      </AppShell>
    </QmLayoutProvider>
  );
}
