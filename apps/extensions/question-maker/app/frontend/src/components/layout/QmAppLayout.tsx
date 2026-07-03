import { type CSSProperties, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { Outlet } from 'react-router';
import {
  AppLauncher,
  AppSidebar,
  SidebarProvider,
  SidebarInset,
  SiteHeader,
  ThemeToggle,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbLink,
  BreadcrumbSeparator,
  Button,
} from '@eduai/ui';
import {
  IconBooks,
  IconBug,
  IconDashboard,
  IconLibrary,
  IconSettings,
  IconHelpCircle,
  IconSearch,
  IconRoute,
  type Icon,
} from '@tabler/icons-react';
import { useAuth } from '@/contexts/AuthContext';
import { useQmLayout, QmLayoutProvider } from '@/components/layout/QmLayoutContext';
import { ProfileCoursesDialog } from '@/components/profile/ProfileCoursesDialog';
import { useCourses } from '@/hooks/useCourses';
import { AIServiceIndicators } from '@/components/eduai/AIServiceIndicators';
import { useEduAIStatus } from '@/hooks/useEduAIStatus';
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
  // footer AppLauncher. Secondary nav only has Help.
  return [
    { key: 'help', title: 'Help', href: '/help' },
  ];
}

function QmSiteHeader() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const eduaiStatus = useEduAIStatus();
  const { startTour } = useGuidedTour();
  const { courses, isLoading: isCoursesLoading } = useCourses();
  const { guidedTourHandler } = useQmLayout();
  const bugReport = useBugReport();

  const handleGuidedTourClick = () => {
    if (guidedTourHandler) {
      guidedTourHandler();
    } else {
      startTour('main');
    }
  };

  const breadcrumbs = <WorkspaceBreadcrumb pathname={pathname} tab={searchParams.get('tab')} />;

  return (
    <SiteHeader
      title={resolveTitle(pathname)}
      breadcrumbs={breadcrumbs}
      actions={
        <>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('qm:open-command'))}
            className="flex h-9 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
            aria-label="Open command palette"
          >
            <IconSearch className="size-3.5" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden rounded border border-border bg-muted px-1 font-sans text-[10px] font-medium sm:inline">⌘K</kbd>
          </button>
          <div data-tour-id="eduai-status">
            <AIServiceIndicators
              status={eduaiStatus.status}
              message={eduaiStatus.message}
              provider={eduaiStatus.provider}
              onRefresh={eduaiStatus.refresh}
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
    />
  );
}

function QmAppLayoutInner() {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const { profileOpen, closeProfile } = useQmLayout();
  const { courses, fetchCourses } = useCourses();

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

  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 72)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as CSSProperties
      }
    >
      <AppSidebar
        logo={qmLogo}
        logoHref="/dashboard"
        navMain={navMain}
        navSecondary={navSecondary}
        currentPath={pathname}
        LinkComponent={Link}
        footer={<AppLauncher apps={getLauncherApps()} currentAppId={CURRENT_APP_ID} role={user?.role} />}
        user={user ? { name: user.name ?? user.email, email: user.email, image: user.image, role: user.role } : { name: 'Guest', email: '', role: 'GUEST' }}
        navUser={
          user ? {
            items: [
              {
                label: 'Settings',
                href: '/settings',
                icon: <IconSettings size={15} strokeWidth={1.75} />,
              },
            ],
            LinkComponent: Link,
            onLogout: logout,
          } : undefined
        }
      />
      <SidebarInset className="min-w-0">
        <QmSiteHeader />
        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </SidebarInset>

      <CommandPalette />

      <ProfileCoursesDialog
        open={profileOpen}
        onClose={closeProfile}
        existingCourses={courses}
        onCoursesAdded={fetchCourses}
      />
    </SidebarProvider>
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
      <SidebarProvider
        style={
          {
            '--sidebar-width': 'calc(var(--spacing) * 72)',
            '--header-height': 'calc(var(--spacing) * 12)',
          } as CSSProperties
        }
      >
        <AppSidebar
          logo={qmLogo}
          logoHref="/dashboard"
          navMain={navMain}
          navSecondary={navSecondary}
          currentPath="/"
          LinkComponent={Link}
          footer={<AppLauncher apps={getLauncherApps()} currentAppId={CURRENT_APP_ID} role={user?.role} />}
          user={user ? { name: user.name ?? user.email, email: user.email, image: user.image, role: user.role } : { name: 'Guest', email: '', role: 'GUEST' }}
          navUser={
            user ? {
              items: [],
              onLogout: logout,
            } : undefined
          }
        />
        <SidebarInset>
          <SiteHeader title="Question Maker" />
          <main className="flex flex-1 items-center justify-center p-4">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </QmLayoutProvider>
  );
}
