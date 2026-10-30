import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { Outlet } from "react-router";
import {
  GettingStartedButton,
  NavShell,
  OnboardingChecklist,
  PageTourButton,
  ThemeToggle,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbPage,
  BreadcrumbLink,
  BreadcrumbSeparator,
  CommandSearchButton,
  AIServiceHistoryPanel,
  useHistoryOnOpen,
  AIServiceIndicators,
  PageHelpButton,
  termLabel,
  visibleAppsForRole,
  type HistoryPayload,
  type NavShellEntry,
  type NavShellLink,
  type NavShellModel,
} from "@eduai/ui";
import { ExtensionHelpAssistant } from "@eduai/ui/assistant";
import {
  IconArrowLeft,
  IconBooks,
  IconBug,
  IconDashboard,
  IconHelpCircle,
  IconLibrary,
  IconSettings,
  type Icon,
} from "@tabler/icons-react";
import { getCoreStatusUrl, getCoreUrl } from "@/lib/coreUrl";
import { QM_ACCESS_HELP } from "@/lib/pageHelpContent";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCanvasLinkStatus,
  useQmLayout,
  QmLayoutProvider,
} from "@/components/layout/QmLayoutContext";
import { ProfileCoursesDialog } from "@/components/profile/ProfileCoursesDialog";
import { useCourses } from "@/hooks/useCourses";
import { useAiServicesStatus, revalidateCloud } from "@/hooks/useAiServicesStatus";
import eduaiService from "@/services/eduaiService";
import { useBugReport } from "@/contexts/BugReportContext";
import { getFooterNavForUser, getNavForUser, getNavSecondaryForUser } from "@/lib/rbac/nav";
import type { QmNavItem, QmNavItemKey, QmUser } from "@/lib/rbac/types";
import { buildQmCourseNav, courseIdFromPath } from "@/components/layout/qmCourseNav";
import { CommandPalette } from "@/components/command/CommandPalette";
import { QmPageHelp } from "@/components/layout/QmPageHelp";
import { CURRENT_APP_ID, getLauncherApps } from "@/lib/apps";
import type { Course } from "@/types/question";
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
 * The breadcrumb off the course workspace, and on a course page while its
 * course is still loading — once it has loaded, the shell's course menu draws
 * the `CODE · term › Section` trail instead.
 */
function WorkspaceBreadcrumb({ pathname }: { pathname: string }) {
  if (courseIdFromPath(pathname) == null) {
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
          <BreadcrumbPage>Course workspace</BreadcrumbPage>
        </BreadcrumbItem>
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

const ACCOUNT_SETTINGS: NavShellLink = {
  key: "settings",
  label: "Settings",
  href: "/settings",
  icon: IconSettings,
};

function toNavLink(item: QmNavItem): NavShellLink {
  return {
    key: item.key,
    label: item.title,
    href: item.href,
    icon: NAV_ICONS[item.key],
    external: item.external,
  };
}

type QmNavUser = QmUser & {
  name?: string | null;
  email: string;
  image?: string | null;
};

/**
 * QM's rail, trays and drawer, from its own RBAC nav (`lib/rbac/nav`): Courses
 * and Help become trays, "Back to EduAI" joins Settings in the Account tray,
 * and the rest stay plain links.
 */
function buildQmNavModel({
  user,
  pathname,
  courses,
  coursesLoading,
  launcherCourseId,
  onLogout,
  onReportBug,
}: {
  user: QmNavUser | null;
  pathname: string;
  courses: Course[];
  coursesLoading: boolean;
  launcherCourseId?: string | null;
  onLogout: () => void;
  onReportBug?: () => void;
}): NavShellModel {
  const entries: NavShellEntry[] = [];
  for (const item of getNavForUser(user)) {
    if (item.key === "courses") {
      entries.push({ kind: "tray", tray: "courses", label: item.title, icon: IconBooks });
    } else {
      entries.push({ kind: "link", link: toNavLink(item) });
    }
  }
  const helpLinks: NavShellLink[] = [];
  for (const item of getNavSecondaryForUser(user)) {
    if (item.key === "help") {
      entries.push({ kind: "tray", tray: "help", label: item.title, icon: IconHelpCircle });
      helpLinks.push({ ...toNavLink(item), label: "Help & guide" });
    } else {
      entries.push({ kind: "link", link: toNavLink(item) });
    }
  }

  return {
    pathname,
    user: user
      ? { name: user.name ?? user.email, email: user.email, image: user.image, role: user.role }
      : { name: "Guest", email: "", role: "GUEST" },
    entries,
    accountLinks: [
      ...(user ? [ACCOUNT_SETTINGS] : []),
      ...getFooterNavForUser(user).map(toNavLink),
    ],
    adminLinks: [],
    helpLinks,
    coursesHref: "/courses",
    courses: {
      status: coursesLoading && courses.length === 0 ? "loading" : "ready",
      courses: courses.map((course) => ({
        id: String(course.id),
        href: `/courses/${course.id}`,
        code: course.code ?? course.name,
        name: course.name,
        subtitle: termLabel(course.term, course.year),
      })),
    },
    launcherApps: visibleAppsForRole(getLauncherApps(launcherCourseId), user?.role),
    currentAppId: CURRENT_APP_ID,
    onLogout,
    onReportBug,
  };
}

function useLogoutWithToast() {
  const { logout } = useAuth();
  return () => {
    void logout().catch(() => {
      toast.error("Could not log out", {
        description: "Your session is still active. Please try again.",
      });
    });
  };
}

function QmAppLayoutInner() {
  const location = useLocation();
  const { pathname, search } = location;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const handleLogout = useLogoutWithToast();
  const { profileOpen, closeProfile } = useQmLayout();
  const { courses, isLoading: isCoursesLoading, fetchCourses } = useCourses();
  const aiStatus = useAiServicesStatus();
  const bugReport = useBugReport();
  const localCourseId = courseIdFromPath(pathname);
  const routeCourse = courses.find((course) => course.id === localCourseId);
  const canvasLinked = useCanvasLinkStatus(localCourseId);
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

  const model = buildQmNavModel({
    user: navigationUser ?? null,
    pathname,
    courses,
    coursesLoading: isCoursesLoading,
    launcherCourseId: coreCourseId,
    onLogout: handleLogout,
    onReportBug: bugReport?.openBugReport,
  });
  const courseNav = buildQmCourseNav({ pathname, search, course: routeCourse, canvasLinked });

  // The question composer relies on a page-level sticky action bar. The
  // shell's default `<main>` is `overflow-auto`, which makes it the sticky
  // containing block — but it never actually scrolls (the document does), so
  // any sticky child is trapped and scrolls away instead of pinning below the
  // header. Drop `overflow-auto` on the composer routes so the bar sticks to
  // the viewport; main clips nothing here anyway.
  const isComposerRoute =
    pathname.endsWith("/questions/new") || /\/questions\/[^/]+\/edit$/.test(pathname);

  return (
    <NavShell
      model={model}
      LinkComponent={Link}
      locationKey={location.key ?? pathname}
      mainClassName={isComposerRoute ? "min-w-0 flex-1" : undefined}
      title={resolveTitle(pathname)}
      breadcrumbs={<WorkspaceBreadcrumb pathname={pathname} />}
      courseNav={courseNav}
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
          <ExtensionHelpAssistant
            coreUrl={getCoreUrl()}
            coreCourseId={coreCourseId ?? null}
            placement="floating"
          />
          <GettingStartedButton
            platform="question-maker"
            userId={user ? String(user.id) : ""}
            role={questionMakerRole}
            pathname={pathname}
            navigate={navigate}
          />
          <PageTourButton
            platform="question-maker"
            pathname={pathname}
            role={questionMakerRole}
            dashboardTour="main"
          />
          {/* Last, so it sits in the header's top-right corner (#1754). The
              guided tour is launched from its modal. The bug report moved
              into the rail's Help tray. */}
          <QmPageHelp showIndicator={courses.length === 0 && !isCoursesLoading} />
        </>
      }
      overlays={
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
      {pathname === "/dashboard" && user ? (
        <OnboardingChecklist
          platform="question-maker"
          userId={String(user.id)}
          role={questionMakerRole}
          navigate={navigate}
        >
          <Outlet />
        </OnboardingChecklist>
      ) : (
        <Outlet />
      )}
    </NavShell>
  );
}

export function QmAppLayout() {
  return (
    <QmLayoutProvider>
      <QmAppLayoutInner />
    </QmLayoutProvider>
  );
}

/** Minimal shell for access-denied and other minimal states. */
export function QmAccessShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user } = useAuth();
  const handleLogout = useLogoutWithToast();

  const model = buildQmNavModel({
    user: user ?? null,
    pathname: "/",
    courses: [],
    coursesLoading: false,
    onLogout: handleLogout,
  });

  return (
    <QmLayoutProvider>
      <NavShell
        model={model}
        LinkComponent={Link}
        locationKey={location.key ?? location.pathname}
        title="Question Maker"
        headerActions={
          <PageHelpButton content={QM_ACCESS_HELP} helpHref={`${getCoreUrl()}/help`} />
        }
      >
        <div className="flex h-full items-center justify-center p-4">{children}</div>
      </NavShell>
    </QmLayoutProvider>
  );
}
