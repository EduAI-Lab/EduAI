import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { useTheme, CommandSearchButton } from "@eduai/ui";
import { BugReportSubmitDialog } from "~/components/shared/bug-report-submit-dialog";
import { AIServiceIndicators } from "~/components/ai/ai-service-indicators";
import { CORE_COMMAND_EVENT } from "~/components/command/command-palette";
import { Separator, SidebarTrigger, useSidebar } from "@eduai/ui";
import { IconSun, IconMoon } from "@tabler/icons-react";

const ROUTE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/courses": "Courses",
  "/chat": "Course Chat",
  "/settings": "Settings",
  "/admin/users": "Users",
  "/admin/ai-models": "AI Models",
  "/admin/bug-reports": "Bug Reports",
  "/admin/chat": "Admin Chatbot",
};

export interface SiteHeaderProps {
  title?: string;
  actions?: React.ReactNode;
  /** Renders after breadcrumbs on the left (e.g. chat "New chat" on Week 7 #659). */
  leadingActions?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
}

function useAssistiveFocusModeActive(): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const sync = () =>
      setActive(root.hasAttribute("data-assistive-focus-mode"));
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-assistive-focus-mode"],
    });
    return () => observer.disconnect();
  }, []);

  return active;
}

/** Shown when sidebar is collapsed, on mobile, or focus mode hides the nav rail. */
function SiteHeaderSidebarTrigger() {
  const { isMobile, state } = useSidebar();
  const focusModeActive = useAssistiveFocusModeActive();

  if (!isMobile && state === "expanded" && !focusModeActive) {
    return null;
  }

  return (
    <>
      <SidebarTrigger className="-ml-1" />
      <Separator
        orientation="vertical"
        className="mx-2 data-[orientation=vertical]:h-4"
      />
    </>
  );
}

export function SiteHeader({
  title,
  actions,
  leadingActions,
  breadcrumbs,
}: SiteHeaderProps) {
  const { pathname } = useLocation();
  const { resolvedTheme, setTheme } = useTheme();
  const resolvedTitle =
    title ??
    ROUTE_TITLES[pathname] ??
    (pathname.startsWith("/courses/") ? "Course Detail" : "EduAI");

  function toggleTheme() {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }

  return (
    <header className="sticky top-0 z-[20] flex h-[var(--header-height)] shrink-0 items-center border-b bg-background">
      <div className="flex h-full w-full items-center gap-1 px-4 lg:gap-2 lg:px-6 lg:py-0">
        <SiteHeaderSidebarTrigger />
        {breadcrumbs ? (
          <>
            <h1 className="sr-only">{resolvedTitle}</h1>
            <div
              className="min-w-0 flex-1 overflow-hidden"
              style={{
                maskImage:
                  "linear-gradient(to right, black calc(100% - 3rem), transparent)",
              }}
            >
              {breadcrumbs}
            </div>
          </>
        ) : (
          <h1 className="text-sm font-normal text-foreground">{resolvedTitle}</h1>
        )}
        {leadingActions ? (
          <div className="flex h-full shrink-0 items-center gap-1.5">
            {leadingActions}
          </div>
        ) : null}
        <div className="ml-auto flex h-full items-center gap-3 sm:gap-4">
          {actions}
          <CommandSearchButton eventName={CORE_COMMAND_EVENT} />
          <AIServiceIndicators />
          <button
            type="button"
            onClick={toggleTheme}
            data-tour="theme-toggle"
            aria-label={
              resolvedTheme === "dark"
                ? "Switch to light mode"
                : "Switch to dark mode"
            }
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {resolvedTheme === "dark" ? (
              <IconSun size={18} aria-hidden="true" />
            ) : (
              <IconMoon size={18} aria-hidden="true" />
            )}
          </button>
          <BugReportSubmitDialog />
        </div>
      </div>
    </header>
  );
}
