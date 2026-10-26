import * as React from "react";
import { Link, useLocation, useNavigate } from "react-router";

import {
  CommandSearchButton,
  NavShell,
  OnboardingChecklist,
  PageTourButton,
  ThemeToggle,
  type CourseNavConfig,
} from "@eduai/ui";

import { AIServiceIndicators } from "~/components/ai/ai-service-indicators";
import { BugReportSubmitDialog } from "~/components/shared/bug-report-submit-dialog";
import { CommandPalette, CORE_COMMAND_EVENT } from "~/components/command/command-palette";
import { CorePageHelp } from "~/components/help/core-page-help";
import { AssistantHeaderButton, HelpAssistant } from "~/components/assistant/help-assistant";
import { useCoreNavModel } from "~/components/layout/core-nav-model";
import { CurrentUserIdProvider } from "~/contexts/current-user";
import type { User } from "~/lib/auth/types";

export type { CourseNavConfig } from "@eduai/ui";

/**
 * Route → header title fallback map, ported verbatim from the old bespoke
 * `~/components/site-header`'s `resolvedTitle` logic (issue #764 core-shell
 * parity). `CoreAppShell` always resolves a title through this, so every
 * route's visible/sr-only heading is unchanged from before — routes that rely
 * on the fallback (e.g. `/settings`) don't need to pass an explicit `title`.
 */
// A `Map` because the key is whatever path the router is on: an unlisted
// route falls through to the course-detail rule, then to the app name.
const ROUTE_TITLES = new Map<string, string>([
  ["/dashboard", "Dashboard"],
  ["/courses", "Courses"],
  ["/chat", "Course Chat"],
  ["/settings", "Settings"],
  ["/admin/users", "Users"],
  ["/admin/ai-models", "AI Models"],
  ["/admin/bug-reports", "Bug Reports"],
  ["/admin/chat", "Admin Chatbot"],
]);

/** Exported for unit tests — see `ROUTE_TITLES` doc comment above. */
export function resolveCoreHeaderTitle(pathname: string, title?: string): string {
  return (
    title ??
    ROUTE_TITLES.get(pathname) ??
    (pathname.startsWith("/courses/") ? "Course Detail" : "EduAI")
  );
}

/**
 * The header's fixed right-hand action bundle, identical across every Core
 * page: quick search, live AI-service status, and the theme toggle, with the
 * page help (?) button pinned last so it sits in the top-right corner (#1754).
 * The bug report trigger moved into the Help tray. `extraActions` renders
 * BEFORE this bundle, for the rare route that needs its own control there too
 * (e.g. the chat page's mobile history toggle).
 */
export function CoreHeaderActions({
  extraActions,
  assistant,
  help,
}: {
  extraActions?: React.ReactNode;
  /**
   * The help assistant's header trigger (#1822) — only shown on chat screens,
   * where a floating bubble would cover the composer. A slot for the same reason
   * as `help`.
   */
  assistant?: React.ReactNode;
  /** The page help trigger. A slot (not built here) so this bundle renders without a router in tests. */
  help?: React.ReactNode;
}) {
  return (
    <>
      {extraActions}
      <CommandSearchButton eventName={CORE_COMMAND_EVENT} />
      <AIServiceIndicators />
      {/* Wrapper carries the dashboard tour's anchor — ThemeToggle itself only
          accepts `className`, so this follows the same pattern as
          AIServiceIndicators' own `data-tour` wrapper span. */}
      <span data-tour="theme-toggle" className="inline-flex">
        <ThemeToggle />
      </span>
      {assistant}
      {help}
    </>
  );
}

export interface CoreAppShellProps {
  user: User;
  /** Explicit header title override. Omit to use the route-derived fallback (see `ROUTE_TITLES`). */
  title?: string;
  /** Breadcrumb trail rendered in place of the plain title — passed straight through from the route. */
  breadcrumbs?: React.ReactNode;
  /**
   * Course pages only: draws the course menu column, the hamburger that
   * toggles it, and the `CODE · term › Section` breadcrumb (which replaces
   * `breadcrumbs`).
   */
  courseNav?: CourseNavConfig;
  /** Route-specific header control(s) rendered before the common action bundle (e.g. chat's history toggle). */
  actions?: React.ReactNode;
  /**
   * Escape hatches for pages with non-standard scroll containment — currently
   * only the chat screens, which own an internally-scrolling layout instead of
   * the standard page-scrolls `<main>`.
   * `insetClassName` replaces the content column's default `min-h-svh`,
   * `mainClassName` replaces `<main>`'s default `min-w-0 flex-1 overflow-auto`,
   * and `providerClassName` is merged onto the outer grid.
   */
  insetClassName?: string;
  mainClassName?: string;
  providerClassName?: string;
  children: React.ReactNode;
}

/**
 * Core's app chrome: the shared `NavShell` (Canvas-style rail, course menu,
 * trays, and mobile drawer) fed with Core's nav model, header actions, and the
 * dialogs that live beside the layout.
 */
export function CoreAppShell({
  user,
  title,
  breadcrumbs,
  courseNav,
  actions,
  insetClassName,
  mainClassName,
  providerClassName,
  children,
}: CoreAppShellProps) {
  const location = useLocation();
  const [bugReportOpen, setBugReportOpen] = React.useState(false);
  const model = useCoreNavModel(user, () => setBugReportOpen(true));
  const { pathname } = location;
  const navigate = useNavigate();

  return (
    <CurrentUserIdProvider userId={user.id}>
      <NavShell
        model={model}
        LinkComponent={Link}
        locationKey={location.key}
        title={resolveCoreHeaderTitle(pathname, title)}
        breadcrumbs={breadcrumbs}
        courseNav={courseNav}
        headerActions={
          <CoreHeaderActions
            extraActions={actions}
            assistant={<AssistantHeaderButton />}
            help={
              <>
                <PageTourButton
                  platform="core"
                  pathname={pathname}
                  role={user.role}
                  dashboardTour="dashboard"
                />
                <CorePageHelp role={user.role} />
              </>
            }
          />
        }
        overlays={
          <>
            <BugReportSubmitDialog open={bugReportOpen} onOpenChange={setBugReportOpen} />
            <CommandPalette user={user} />
          </>
        }
        insetClassName={insetClassName}
        mainClassName={mainClassName}
        providerClassName={providerClassName}
      >
        {pathname === "/dashboard" && (
          <OnboardingChecklist
            platform="core"
            userId={user.id}
            role={user.role}
            navigate={navigate}
          />
        )}
        {children}
      </NavShell>
      {/* #1822: the one mount point for the help assistant. It renders nothing
          unless the root loader's gate says it could answer for this user. */}
      <HelpAssistant user={user} />
    </CurrentUserIdProvider>
  );
}
