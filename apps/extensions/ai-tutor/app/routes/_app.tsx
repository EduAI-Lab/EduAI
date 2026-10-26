import { useCallback, useState } from "react";
import { Link, Outlet, useLocation, useMatches, useNavigate } from "react-router";
import {
  OnboardingChecklist,
  PageTourButton,
  AIServiceHistoryPanel,
  AIServiceIndicators,
  BugReportDialog,
  CommandSearchButton,
  NavShell,
  ThemeToggle,
  termLabel,
  useAiServiceStatus,
  useHistoryOnOpen,
  visibleAppsForRole,
  type BugReportSubmitData,
  type HistoryPayload,
  type NavShellCourse,
  type NavShellEntry,
  type NavShellModel,
} from "@eduai/ui";
import { assistantPlacementFor, ExtensionHelpAssistant } from "@eduai/ui/assistant";
import { getCoreDashboardUrl, getCoreStatusUrl, getCoreUrl } from "../lib/coreUrl";
import {
  IconArrowLeft,
  IconBooks,
  IconDashboard,
  IconHelpCircle,
  IconSettings,
  IconShieldLock,
} from "@tabler/icons-react";
import type { Icon } from "@tabler/icons-react";
import { toast } from "sonner";

import api from "~/lib/api";
import { useLocalUser } from "~/hooks/useLocalUser";
import { getNavForUser } from "~/lib/rbac/nav";
import type { AtNavItemKey, AtUser } from "~/lib/rbac/types";
import { courseCode, courseName, courseTerm, courseYear } from "~/lib/course-display";
import { CURRENT_APP_ID, getLauncherApps } from "~/lib/apps";
import { getRouteCourseId } from "~/lib/route-course";
import { CommandPalette, AITUTOR_COMMAND_EVENT } from "~/components/command/CommandPalette";
import { useBugReport } from "~/components/bug-report/useBugReport";
import { ShellBreadcrumbs } from "~/components/layout/ShellBreadcrumbs";
import {
  ShellBreadcrumbProvider,
  useShellBreadcrumbState,
} from "~/components/layout/ShellBreadcrumbContext";
import {
  ShellCourseNavProvider,
  useShellCourseNavState,
} from "~/components/layout/ShellCourseNavContext";
import { AiTutorPageHelp } from "~/components/help/AiTutorPageHelp";

const NAV_ICONS = {
  dashboard: IconDashboard,
  "my-courses": IconBooks,
  teaching: IconBooks,
  "admin-courses": IconBooks,
  "admin-bug-reports": IconShieldLock,
  enrollments: IconBooks,
  analytics: IconBooks,
} satisfies Record<AtNavItemKey, Icon>;

/** How many courses the Courses tray lists before deferring to the full list. */
const NAV_COURSES_PAGE_SIZE = 20;

type AtNavUser = AtUser & { name: string; email?: string | null };

/**
 * AI Tutor's rail, trays and drawer, from its own RBAC nav (`lib/rbac/nav`):
 * the role's Courses entry becomes the Courses tray, Help becomes a tray with
 * the guide and the bug report, and "Back to EduAI" joins Settings in the
 * Account tray.
 */
function buildAtNavModel({
  user,
  pathname,
  launcherCourseId,
  onLogout,
  onReportBug,
}: {
  user: AtNavUser;
  pathname: string;
  launcherCourseId: string | null;
  onLogout: () => void;
  onReportBug: () => void;
}): NavShellModel {
  // STUDENT stays in the /student shell; everyone else uses the /instructor shell.
  const coursePrefix = user.role === "STUDENT" ? "/student" : "/instructor";
  let coursesHref = coursePrefix;
  const entries: NavShellEntry[] = [];
  for (const item of getNavForUser(user)) {
    if (item.key === "my-courses" || item.key === "teaching" || item.key === "admin-courses") {
      coursesHref = item.href;
      entries.push({ kind: "tray", tray: "courses", label: item.title, icon: IconBooks });
    } else {
      entries.push({
        kind: "link",
        link: { key: item.key, label: item.title, href: item.href, icon: NAV_ICONS[item.key] },
      });
    }
  }
  entries.push({ kind: "tray", tray: "help", label: "Help", icon: IconHelpCircle });

  const loadCourses = async (): Promise<NavShellCourse[]> => {
    const page = await api.listCourses({ pageSize: NAV_COURSES_PAGE_SIZE });
    return page.data.map((course) => ({
      id: String(course.id),
      href: `${coursePrefix}/courses/${course.id}`,
      code: courseCode(course),
      name: courseName(course),
      subtitle: termLabel(courseTerm(course), courseYear(course)),
    }));
  };

  return {
    pathname,
    user: { name: user.name, email: user.email ?? "", role: user.role },
    entries,
    accountLinks: [
      { key: "settings", label: "Settings", href: "/settings", icon: IconSettings },
      // Same "Back to EduAI" link Question Maker shows.
      {
        key: "back-to-eduai",
        label: "Back to EduAI",
        href: getCoreDashboardUrl(),
        icon: IconArrowLeft,
        external: true,
      },
    ],
    adminLinks: [],
    helpLinks: [{ key: "help", label: "Help & guide", href: "/help", icon: IconHelpCircle }],
    coursesHref,
    loadCourses,
    launcherApps: visibleAppsForRole(getLauncherApps(launcherCourseId), user.role),
    currentAppId: CURRENT_APP_ID,
    onLogout,
    onReportBug,
  };
}

/** Lesson pages carry the student's own AI chat, so Penny opens from the header there. */
const CHAT_SCREEN_PREFIXES = ["/student/lesson"];

/** Reads the active route's published breadcrumb trail (see ShellBreadcrumbContext). */
function HeaderBreadcrumbs() {
  const items = useShellBreadcrumbState();
  // Anchors the lesson tour's "climb back up a level" step.
  return (
    <div data-tour="shell-breadcrumbs" className="min-w-0">
      <ShellBreadcrumbs items={items} />
    </div>
  );
}

function AppLayoutInner() {
  const location = useLocation();
  const { pathname, search } = location;
  const matches = useMatches();
  const navigate = useNavigate();
  const { user, logout } = useLocalUser();
  const { captureScreenshot, getCapturedData, clearScreenshot, context } = useBugReport();
  // 300s, not the hook's 60s default: the underlying value only changes when
  // the cron probe runs (roughly every 15 minutes), so polling every minute is
  // pure waste — Core already sets this explicitly for the same reason.
  const aiStatus = useAiServiceStatus({
    fetcher: (signal) => api.aiStatus(signal),
    intervalMs: 300_000,
  });
  const [bugReportOpen, setBugReportOpen] = useState(false);
  const routeCourseId = getRouteCourseId(matches);
  const coreCourseId = routeCourseId ?? new URLSearchParams(search).get("coreCourseId");
  const breadcrumbItems = useShellBreadcrumbState();
  const courseNav = useShellCourseNavState();

  const fetchAiHistory = useCallback(() => api.aiStatusHistory(), []);

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

  // All hooks above run unconditionally (rules of hooks) — everything below
  // may branch. Bare `<Outlet />` while `!user` matches the old per-route
  // `<AppShell>`'s behavior: the route's own `clientLoader` has already
  // confirmed a session via `requireClientUser`, but `useLocalUser()`'s local
  // `/api/me` state can briefly still be initializing when this first renders.
  if (!user) {
    return <Outlet />;
  }

  const handleOpenBugReport = () => setBugReportOpen(true);

  const handleBugReportOpenChange = (next: boolean) => {
    if (!next) clearScreenshot();
    setBugReportOpen(next);
  };

  const handleSubmitBugReport = async (data: BugReportSubmitData) => {
    await api.submitBugReport({
      description: data.description,
      bugType: data.bugType,
      isAnonymous: data.isAnonymous,
      // The dialog fills these only after the reporter opts in; otherwise they stay null.
      consoleLogs: data.consoleLogs ?? null,
      networkLogs: data.networkLogs ?? null,
      screenshot: data.screenshot ?? null,
      pageUrl: data.pageUrl ?? null,
      userAgent: data.userAgent ?? null,
      context,
    });
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate("/");
    } catch {
      toast.error("Could not log out", {
        description: "Your session is still active. Please try again.",
      });
    }
  };

  const model = buildAtNavModel({
    user,
    pathname,
    launcherCourseId: coreCourseId,
    onLogout: () => void handleLogout(),
    onReportBug: handleOpenBugReport,
  });

  return (
    <NavShell
      model={model}
      LinkComponent={Link}
      locationKey={location.key}
      // The mobile header's title (and the sr-only heading beside the trail).
      title={breadcrumbItems.at(-1)?.label ?? "AI Tutor"}
      breadcrumbs={<HeaderBreadcrumbs />}
      courseNav={courseNav}
      headerActions={
        <>
          <CommandSearchButton eventName={AITUTOR_COMMAND_EVENT} />
          <AIServiceIndicators
            cloud={aiStatus.cloud}
            cloudLabel="Managed cloud AI"
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
            onRefresh={aiStatus.refresh}
            onUbcOpenChange={onAiHistoryOpenChange}
          />
          <ThemeToggle className="size-9 min-h-9 min-w-9" />
          <ExtensionHelpAssistant
            coreUrl={getCoreUrl()}
            coreCourseId={coreCourseId}
            placement={assistantPlacementFor(pathname, CHAT_SCREEN_PREFIXES)}
          />
          <PageTourButton platform="ai-tutor" pathname={pathname} role={user.role} />
          {/* Last, so it sits in the header's top-right corner (#1754). The
              bug report moved into the rail's Help tray. */}
          <AiTutorPageHelp role={user.role} />
        </>
      }
      overlays={
        <>
          <CommandPalette />
          <BugReportDialog
            open={bugReportOpen}
            onOpenChange={handleBugReportOpenChange}
            onSubmit={handleSubmitBugReport}
            captureScreenshot={captureScreenshot}
            getCapturedData={getCapturedData}
          />
        </>
      }
    >
      {pathname === "/dashboard" && (
        <OnboardingChecklist
          platform="ai-tutor"
          userId={user.id}
          role={user.role}
          navigate={navigate}
        />
      )}
      <Outlet />
    </NavShell>
  );
}

/**
 * Authenticated app chrome: the shared `@eduai/ui` `NavShell`, mounted as a
 * single layout route (issue #764) instead of AI Tutor's old forked
 * per-route `<AppShell>` composition. Structured like QM's
 * `QmAppLayout` → `QmAppLayoutInner` split so `ShellBreadcrumbProvider` and
 * `ShellCourseNavProvider` always wrap `<Outlet />` (both the pre-auth and
 * authenticated states), which keeps `useShellBreadcrumbs` and
 * `useShellCourseNav` safe to call from every child route.
 */
export default function AppLayout() {
  return (
    <ShellBreadcrumbProvider>
      <ShellCourseNavProvider>
        <AppLayoutInner />
      </ShellCourseNavProvider>
    </ShellBreadcrumbProvider>
  );
}
