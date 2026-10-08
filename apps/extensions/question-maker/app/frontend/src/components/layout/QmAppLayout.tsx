import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { Outlet } from "react-router";
import {
  AppShell,
  ThemeToggle,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbLink,
  BreadcrumbSeparator,
  BugReportTriggerButton,
  CommandSearchButton,
  AIServiceHistoryPanel,
  useHistoryOnOpen,
  AIServiceIndicators,
  PageHelpButton,
  type HistoryPayload,
} from "@eduai/ui";
import {
  IconArrowLeft,
  IconBooks,
  IconBug,
  IconDashboard,
  IconLibrary,
  IconSettings,
  IconHelpCircle,
  type Icon,
} from "@tabler/icons-react";
import { getCoreStatusUrl, getCoreUrl } from "@/lib/coreUrl";
import { QM_ACCESS_HELP } from "@/lib/pageHelpContent";
import { useAuth } from "@/contexts/AuthContext";
import { useQmLayout, QmLayoutProvider } from "@/components/layout/QmLayoutContext";
import { ProfileCoursesDialog } from "@/components/profile/ProfileCoursesDialog";
import { useCourses } from "@/hooks/useCourses";
import { useAiServicesStatus, revalidateCloud } from "@/hooks/useAiServicesStatus";
import eduaiService from "@/services/eduaiService";
import { useBugReport } from "@/contexts/BugReportContext";
import { getFooterNavForUser, getNavForUser, getNavSecondaryForUser } from "@/lib/rbac/nav";
import type { QmNavItemKey } from "@/lib/rbac/types";
import { CourseSwitcher } from "@/components/layout/CourseSwitcher";
import { CommandPalette } from "@/components/command/CommandPalette";
import { QmPageHelp } from "@/components/layout/QmPageHelp";
import { CURRENT_APP_ID, getLauncherApps } from "@/lib/apps";
import { toast } from "sonner";
import { courseService } from "@/services/courseService";

// A `Map` because the key is whatever path the router is on: an unlisted
// route falls back to the app name rather than reading `undefined` off a
// dictionary that claimed to have every string.
const ROUTE_TITLES = new Map<string, string>([
  ["/dashboard", "Dashboard"],
  ["/courses", "Courses"],
  ["/library", "Question Library"],
  ["/settings", "Settings"],
  ["/help", "Help"],
  ["/admin/bug-reports", "Bug reports"],
]);

function resolveTitle(pathname: string): string {
  if (pathname.startsWith("/courses/") && pathname !== "/courses") {
    return "Course workspace";
  }
  return ROUTE_TITLES.get(pathname) ?? "Question Maker";
}

/**
 * Route-aware breadcrumb: a real trail for the course workspace (with an inline
 * course switcher) and a single page label everywhere else. Deep routes (composer,
 * builder, variants) add a third crumb; on a workspace tab the tab bar shows it.
 */
function WorkspaceBreadcrumb({ pathname }: { pathname: string }) {
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

  // Deep routes add one current-page crumb (same pattern as assessment builder).
  // Return to the workspace tab via the page's "Back to …" control, not a Banks/Assessments crumb.
  let sub: string | null = null;
  if (pathname.endsWith("/questions/new")) sub = "New question";
  else if (/\/questions\/[^/]+\/edit$/.test(pathname)) sub = "Edit question";
  else if (/\/questions\/[^/]+\/variant$/.test(pathname)) sub = "New variant";
  else if (/\/assessments\/[^/]+\/variants$/.test(pathname)) sub = "Variants";
  else if (/\/assessments\/[^/]+$/.test(pathname)) sub = "Assessment builder";
  else if (/\/banks\/[^/]+$/.test(pathname)) sub = "Question bank";

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

const NAV_ICONS = {
  dashboard: IconDashboard,
  courses: IconBooks,
  library: IconLibrary,
  help: IconHelpCircle,
  "bug-reports": IconBug,
  "back-to-eduai": IconArrowLeft,
} satisfies Record<QmNavItemKey, Icon>;

/** QM brand mark shown in the sidebar header (and the AppSidebar app switcher trigger). */
const qmLogo = (
  <>
    <div
      className="flex shrink-0 items-center justify-center"
      style={{
        width: 28,
        height: 28,
        borderRadius: 7,
        background: "var(--primary)",
      }}
    >
      <IconBooks className="size-4 text-[var(--gold)]" strokeWidth={1.75} />
    </div>
    <span className="text-base font-bold" style={{ letterSpacing: "-0.01em" }}>
      Question Maker
    </span>
  </>
);

function QmAppLayoutInner() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, logout } = useAuth();
  const { profileOpen, closeProfile } = useQmLayout();
  const { courses, isLoading: isCoursesLoading, fetchCourses } = useCourses();
  const aiStatus = useAiServicesStatus();
  const bugReport = useBugReport();
  const localCourseId = Number(pathname.match(/^\/courses\/(\d+)/)?.[1]);
  const routeCourse = courses.find((course) => course.id === localCourseId);
  const requestedCoreCourseId = searchParams.get("coreCourseId")?.trim();
  const coreCourseId = routeCourse?.coreCourseId ?? requestedCoreCourseId;
  const navigationUser = user ? { ...user, role: user.questionMakerRole ?? user.role } : user;
  const questionMakerRole = navigationUser?.role;
  const attemptedCourseImport = useRef<string | null>(null);

  const fetchAiHistory = useCallback(() => eduaiService.getAiStatusHistory(), []);

  // One request per deliberate open, even when every one of them fails. The
  // shared hook replaced three near-identical copies of this block that
  // re-requested in a loop on a persistent 401/500 — see `useHistoryOnOpen`.
  const {
    data: aiHistory,
    loading: aiHistoryLoading,
    error: aiHistoryError,
    onOpenChange: onAiHistoryOpenChange,
    refresh: refreshAiHistory,
  } = useHistoryOnOpen<HistoryPayload>(fetchAiHistory);

  useEffect(() => {
    if (!requestedCoreCourseId || isCoursesLoading || routeCourse) return;
    const course = courses.find((item) => item.coreCourseId === requestedCoreCourseId);
    if (course) {
      navigate(
        `/courses/${course.id}?tab=overview&coreCourseId=${encodeURIComponent(requestedCoreCourseId)}`,
        { replace: true },
      );
      return;
    }
    if (attemptedCourseImport.current === requestedCoreCourseId) return;
    attemptedCourseImport.current = requestedCoreCourseId;
    void courseService
      .createCourse({ coreCourseId: requestedCoreCourseId })
      .then((created) =>
        navigate(
          `/courses/${created.id}?tab=overview&coreCourseId=${encodeURIComponent(requestedCoreCourseId)}`,
          { replace: true },
        ),
      )
      .catch(() => toast.error("Could not open this Core course in Question Maker"));
  }, [courses, isCoursesLoading, navigate, requestedCoreCourseId, routeCourse]);
  const handleLogout = () => {
    void logout().catch(() => {
      toast.error("Could not log out", {
        description: "Your session is still active. Please try again.",
      });
    });
  };

  const navMain = getNavForUser(navigationUser).map((item) => ({
    title: item.title,
    url: item.href,
    icon: NAV_ICONS[item.key],
    external: item.external,
  }));

  const navSecondary = getNavSecondaryForUser(navigationUser).map((item) => ({
    title: item.title,
    url: item.href,
    icon: NAV_ICONS[item.key],
    external: item.external,
  }));

  const navFooter = getFooterNavForUser(navigationUser).map((item) => ({
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
    pathname.endsWith("/questions/new") || /\/questions\/[^/]+\/edit$/.test(pathname);

  return (
    <AppShell
      mainClassName={isComposerRoute ? "min-w-0 flex-1" : undefined}
      sidebar={{
        logo: qmLogo,
        logoHref: "/dashboard",
        navMain,
        navSecondary,
        navFooter,
        currentPath: pathname,
        LinkComponent: Link,
        launcher: {
          apps: getLauncherApps(coreCourseId),
          currentAppId: CURRENT_APP_ID,
          role: questionMakerRole,
        },
        user: user
          ? {
              name: user.name ?? user.email,
              email: user.email,
              image: user.image,
              role: questionMakerRole,
            }
          : { name: "Guest", email: "", role: "GUEST" },
        navUser: user
          ? {
              items: [
                {
                  label: "Settings",
                  href: "/settings",
                  icon: <IconSettings size={15} strokeWidth={1.75} />,
                },
              ],
              LinkComponent: Link,
              onLogout: handleLogout,
            }
          : undefined,
      }}
      title={resolveTitle(pathname)}
      breadcrumbs={<WorkspaceBreadcrumb pathname={pathname} />}
      headerActions={
        <>
          <CommandSearchButton eventName="qm:open-command" />
          <div data-tour="eduai-status">
            <AIServiceIndicators
              cloud={aiStatus.cloud}
              ubc={aiStatus.ubc}
              ubcHistory={
                <AIServiceHistoryPanel
                  data={aiHistory}
                  loading={aiHistoryLoading}
                  error={aiHistoryError}
                  stale={aiStatus.stale}
                  checkedAt={aiStatus.checkedAt}
                  current={aiStatus.ubc}
                  statusPageHref={getCoreStatusUrl()}
                  statusPageTarget="_blank"
                  onRefresh={() => {
                    aiStatus.refresh();
                    refreshAiHistory();
                  }}
                />
              }
              onRefresh={() => {
                // Clicking the cloud chip re-validates on demand (task 15) —
                // the one live provider round-trip this hook otherwise
                // avoids. revalidateCloud() caches the fresh verdict, then
                // aiStatus.refresh() re-runs the (synchronous, cache-only)
                // fetcher so the chip picks it up immediately.
                void revalidateCloud().then(() => aiStatus.refresh());
              }}
              onUbcOpenChange={onAiHistoryOpenChange}
            />
          </div>
          <ThemeToggle className="size-9 min-h-9 min-w-9" />
          {bugReport ? <BugReportTriggerButton onClick={bugReport.openBugReport} /> : null}
          {/* Last, so it sits in the header's top-right corner (#1754). The
              guided tour is launched from its modal. */}
          <QmPageHelp showIndicator={courses.length === 0 && !isCoursesLoading} />
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
  const handleLogout = () => {
    void logout().catch(() => {
      toast.error("Could not log out", {
        description: "Your session is still active. Please try again.",
      });
    });
  };

  const navMain = getNavForUser(user).map((item) => ({
    title: item.title,
    url: item.href,
    icon: NAV_ICONS[item.key],
    external: item.external,
  }));

  const navSecondary = getNavSecondaryForUser(user).map((item) => ({
    title: item.title,
    url: item.href,
    icon: NAV_ICONS[item.key],
    external: item.external,
  }));

  const navFooter = getFooterNavForUser(user).map((item) => ({
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
          logoHref: "/dashboard",
          navMain,
          navSecondary,
          navFooter,
          currentPath: "/",
          LinkComponent: Link,
          launcher: { apps: getLauncherApps(), currentAppId: CURRENT_APP_ID, role: user?.role },
          user: user
            ? {
                name: user.name ?? user.email,
                email: user.email,
                image: user.image,
                role: user.role,
              }
            : { name: "Guest", email: "", role: "GUEST" },
          navUser: user ? { items: [], onLogout: handleLogout } : undefined,
        }}
        title="Question Maker"
        headerActions={
          <PageHelpButton content={QM_ACCESS_HELP} helpHref={`${getCoreUrl()}/help`} />
        }
      >
        <div className="flex h-full items-center justify-center p-4">{children}</div>
      </AppShell>
    </QmLayoutProvider>
  );
}
