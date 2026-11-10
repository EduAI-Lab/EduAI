import * as React from "react";
import { IconMenu2 } from "@tabler/icons-react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../ui/breadcrumb";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "../ui/sheet";
import { TooltipProvider } from "../ui/tooltip";
import { cn } from "../utils";
import { CourseNavMenu, SectionNavMenu } from "./course-nav-menu";
import { GlobalNavRail } from "./global-nav-rail";
import { MobileNav } from "./mobile-nav";
import { currentLauncherApp, launcherShortName, NavAnchor, NavLinkProvider } from "./nav-shared";
import { RAIL_WIDTH } from "./nav-trays";
import type {
  CourseNavConfig,
  NavLinkComponent,
  NavOpenTray,
  NavShellModel,
  SectionNavConfig,
} from "./types";
import {
  COURSE_MENU_OPEN_KEY,
  RAIL_COLLAPSED_KEY,
  SECTION_MENU_OPEN_KEY,
  useNavBreakpoint,
  usePersistedFlag,
} from "./use-nav-layout";

/** Width of the course menu column (and of its tablet overlay drawer). */
const COURSE_MENU_WIDTH = 180;
/** Width of a section menu, which also fits each link's icon and count badge. */
const SECTION_MENU_WIDTH = 200;
/** Height of the top bar (`h-12`), which the course menu sits beneath. */
const HEADER_HEIGHT = 48;

export interface NavShellProps {
  model: NavShellModel;
  /** The app's router link (React Router's `Link`); receives `to` and `href`. */
  LinkComponent: NavLinkComponent;
  /**
   * Changes on every navigation (React Router's `location.key`). Open trays
   * and drawers close when it does.
   */
  locationKey: string;
  /** The page title: the header's heading (sr-only beside a breadcrumb) and the mobile header's text. */
  title: string;
  /**
   * Breadcrumb trail rendered in place of the plain title. It should open with
   * the app's name, as the course and title-only headers the shell draws
   * itself do, so it is always clear which app you're in.
   */
  breadcrumbs?: React.ReactNode;
  /** Where the app-name crumb links (the app's landing page). Defaults to `/dashboard`. */
  appHomeHref?: string;
  /**
   * The app-name crumb's text. Defaults to the current app's launcher name,
   * which a user the launcher hides the app from (an access-denied page) lacks.
   */
  appName?: string;
  /**
   * The app's pages draw their own `<h1>` (AI Tutor's do), so the header's
   * title must not be a second one: it is left out beside a breadcrumb and
   * shown as plain text otherwise.
   */
  headingInPage?: boolean;
  /**
   * Course pages only: draws the course menu column, the hamburger that
   * toggles it, and the `CODE · term › Section` breadcrumb (which replaces
   * `breadcrumbs`).
   */
  courseNav?: CourseNavConfig;
  /**
   * A section's own menu (e.g. Administration), drawn in the course menu's
   * column with the same hamburger and tablet drawer. Ignored when
   * `courseNav` is set.
   */
  sectionNav?: SectionNavConfig;
  /** Right-aligned header controls. */
  headerActions?: React.ReactNode;
  /** Dialogs and floating pieces that live beside the layout (command palette, bug report, …). */
  overlays?: React.ReactNode;
  /**
   * Escape hatches for pages with non-standard scroll containment (e.g. a
   * chat screen with its own scrolling pane). `insetClassName` replaces the
   * content column's default `min-h-svh`, `mainClassName` replaces `<main>`'s
   * default `min-w-0 flex-1 overflow-auto`, and `providerClassName` is merged
   * onto the outer grid.
   */
  insetClassName?: string;
  mainClassName?: string;
  providerClassName?: string;
  children: React.ReactNode;
}

/**
 * The EduAI app chrome, laid out like stock Canvas: the global rail, then a
 * column whose top bar runs the full width, with the course menu (course pages
 * only) under it beside the page. Shared by Core,
 * Question Maker and AI Tutor; each app supplies the nav model and slots.
 *
 * - ≥1024px: the rail (labels, or icon-only by saved choice) and the course
 *   menu column, which the hamburger collapses to zero width.
 * - 768–1023px: the rail is always icon-only and the course menu becomes an
 *   overlay drawer.
 * - <768px: no rail; a fixed navy header opens a modal drawer holding the
 *   whole nav (see `MobileNav`).
 *
 * Any open tray or drawer closes on navigation and when the viewport crosses a
 * breakpoint, so nothing is left stuck open in a layout that no longer shows
 * its trigger.
 */
export function NavShell({
  model,
  LinkComponent,
  locationKey,
  title,
  breadcrumbs,
  appHomeHref = "/dashboard",
  appName: appNameProp,
  headingInPage = false,
  courseNav,
  sectionNav,
  headerActions,
  overlays,
  insetClassName,
  mainClassName,
  providerClassName,
  children,
}: NavShellProps) {
  const breakpoint = useNavBreakpoint();
  const [railCollapsed, setRailCollapsed] = usePersistedFlag(RAIL_COLLAPSED_KEY, false);
  const hasCourseMenu = Boolean(courseNav && courseNav.items.length > 0);
  const activeSectionNav =
    !hasCourseMenu && sectionNav && sectionNav.links.length > 0 ? sectionNav : undefined;
  // The course menu and a section menu remember their open state separately:
  // hiding one should not hide the other on the next page that has it.
  const [courseMenuOpen, setCourseMenuOpen] = usePersistedFlag(
    activeSectionNav ? SECTION_MENU_OPEN_KEY : COURSE_MENU_OPEN_KEY,
    true,
  );
  const [openTray, setOpenTray] = React.useState<NavOpenTray | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [courseDrawerOpen, setCourseDrawerOpen] = React.useState(false);
  const hamburgerRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    setOpenTray(null);
    setMobileNavOpen(false);
    setCourseDrawerOpen(false);
  }, [breakpoint, locationKey]);

  const TitleTag = headingInPage ? "p" : "h1";
  const appName = appNameProp ?? launcherShortName(currentLauncherApp(model));
  const iconOnly = railCollapsed || breakpoint === "tablet";
  const hasSideMenu = hasCourseMenu || Boolean(activeSectionNav);
  const sideMenuName = activeSectionNav ? `${activeSectionNav.title} menu` : "course menu";
  const sideMenuWidth = activeSectionNav ? SECTION_MENU_WIDTH : COURSE_MENU_WIDTH;
  const courseMenuShown = breakpoint === "tablet" ? courseDrawerOpen : courseMenuOpen;

  const { onReportBug } = model;
  const openBugReport = onReportBug
    ? () => {
        setOpenTray(null);
        setMobileNavOpen(false);
        onReportBug();
      }
    : undefined;

  const toggleCourseMenu = () => {
    if (breakpoint === "tablet") setCourseDrawerOpen((open) => !open);
    else setCourseMenuOpen(!courseMenuOpen);
  };

  return (
    <NavLinkProvider LinkComponent={LinkComponent}>
      <TooltipProvider delayDuration={0}>
        <div
          className={cn(
            "grid min-h-svh w-full grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)]",
            providerClassName,
          )}
        >
          <GlobalNavRail
            model={model}
            collapsed={railCollapsed}
            onCollapsedChange={setRailCollapsed}
            iconOnly={iconOnly}
            openTray={openTray}
            onOpenTrayChange={setOpenTray}
            onReportBug={openBugReport}
          />

          <div
            className={cn(
              "relative flex w-full min-w-0 flex-col bg-background max-md:pt-14",
              insetClassName ?? "min-h-svh",
            )}
          >
            <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center border-b bg-background max-md:top-14">
              <div className="flex h-full w-full min-w-0 items-center gap-2 px-4 lg:px-6">
                {hasSideMenu && (
                  <button
                    ref={hamburgerRef}
                    type="button"
                    onClick={toggleCourseMenu}
                    aria-expanded={courseMenuShown}
                    aria-controls={breakpoint === "tablet" ? "course-menu-drawer" : "course-menu"}
                    aria-label={`${courseMenuShown ? "Hide" : "Show"} ${sideMenuName}`}
                    className="-ml-2 hidden size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"
                  >
                    <IconMenu2 size={20} aria-hidden="true" />
                  </button>
                )}
                {courseNav ? (
                  <>
                    {!headingInPage && <h1 className="sr-only">{title}</h1>}
                    <CourseBreadcrumb config={courseNav} appName={appName} appHref={appHomeHref} />
                  </>
                ) : breadcrumbs ? (
                  <>
                    {!headingInPage && <h1 className="sr-only">{title}</h1>}
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
                  <Breadcrumb className="min-w-0 flex-1">
                    <BreadcrumbList className="flex-nowrap">
                      {/* A page titled with the app's own name needs no second crumb. */}
                      {title !== appName && (
                        <>
                          <AppBreadcrumbItem label={appName} href={appHomeHref} />
                          <BreadcrumbSeparator />
                        </>
                      )}
                      <BreadcrumbItem className="min-w-0">
                        <TitleTag className="truncate text-sm font-normal text-foreground">
                          {title}
                        </TitleTag>
                      </BreadcrumbItem>
                    </BreadcrumbList>
                  </Breadcrumb>
                )}
                <div className="ml-auto flex h-full shrink-0 items-center gap-3 overflow-x-auto sm:gap-4">
                  {headerActions}
                </div>
              </div>
            </header>
            {/* The header spans the whole content area; the course menu sits
                under it, beside the page. */}
            <div className="flex min-h-0 min-w-0 flex-1">
              {hasSideMenu && (
                <aside
                  id="course-menu"
                  aria-label={activeSectionNav ? sideMenuName : "Course menu"}
                  // Collapsed to zero width rather than unmounted, so the width
                  // can animate; `inert` keeps the hidden links out of the tab
                  // order. Sticky just below the header, like Canvas.
                  inert={!courseMenuOpen}
                  className="sticky top-12 hidden h-[calc(100svh-3rem)] shrink-0 self-start overflow-y-auto overflow-x-hidden bg-background transition-[width] duration-200 motion-reduce:transition-none lg:block"
                  style={{ width: courseMenuOpen ? sideMenuWidth : 0 }}
                >
                  {courseNav && hasCourseMenu ? (
                    <CourseNavMenu config={courseNav} className="w-[180px]" />
                  ) : (
                    activeSectionNav && (
                      <SectionNavMenu
                        config={activeSectionNav}
                        pathname={model.pathname}
                        className="w-[200px]"
                      />
                    )
                  )}
                </aside>
              )}
              <main className={cn("min-w-0", mainClassName ?? "flex-1 overflow-auto")}>
                {children}
              </main>
            </div>
          </div>
        </div>

        {hasSideMenu && breakpoint === "tablet" && (
          <Sheet open={courseDrawerOpen} onOpenChange={setCourseDrawerOpen} modal={false}>
            <SheetContent
              id="course-menu-drawer"
              side="left"
              // Opens under the header, as the column does on desktop.
              style={{
                left: RAIL_WIDTH.iconOnly,
                top: HEADER_HEIGHT,
                height: `calc(100% - ${HEADER_HEIGHT}px)`,
                width: sideMenuWidth + 40,
              }}
              className="z-30 gap-0 overflow-y-auto p-0 shadow-xl sm:max-w-none data-[state=closed]:duration-200 data-[state=open]:duration-200 motion-reduce:!animate-none [&>button:last-child]:hidden"
              onInteractOutside={(event) => {
                // The hamburger toggles the drawer itself; letting the outside
                // click close it first would make that toggle reopen it.
                if (hamburgerRef.current?.contains(event.target as Node)) event.preventDefault();
              }}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                hamburgerRef.current?.focus();
              }}
            >
              <SheetTitle className="sr-only">
                {activeSectionNav ? sideMenuName : "Course menu"}
              </SheetTitle>
              <SheetDescription className="sr-only">
                {activeSectionNav
                  ? `${activeSectionNav.title} pages`
                  : `${courseNav?.code} sections`}
              </SheetDescription>
              {courseNav && hasCourseMenu ? (
                <CourseNavMenu config={courseNav} onNavigate={() => setCourseDrawerOpen(false)} />
              ) : (
                activeSectionNav && (
                  <SectionNavMenu
                    config={activeSectionNav}
                    pathname={model.pathname}
                    onNavigate={() => setCourseDrawerOpen(false)}
                  />
                )
              )}
            </SheetContent>
          </Sheet>
        )}

        <MobileNav
          model={model}
          title={title}
          open={mobileNavOpen}
          onOpenChange={setMobileNavOpen}
          courseNav={courseNav}
          onReportBug={openBugReport}
        />
        {overlays}
      </TooltipProvider>
    </NavLinkProvider>
  );
}

/** `BIOL 116 · 2026-27W1 › Materials` — the course part links to the course's landing section. */
/**
 * The trail's first crumb: the app's name ("Core", "AI Tutor", …), linking to
 * its landing page. Apps that pass their own `breadcrumbs` open with the same crumb.
 */
function AppBreadcrumbItem({ label, href }: { label: string; href: string }) {
  return (
    <BreadcrumbItem className="shrink-0">
      <BreadcrumbLink asChild>
        <NavAnchor href={href} className="font-medium">
          {label}
        </NavAnchor>
      </BreadcrumbLink>
    </BreadcrumbItem>
  );
}

function CourseBreadcrumb({
  config,
  appName,
  appHref,
}: {
  config: CourseNavConfig;
  appName: string;
  appHref: string;
}) {
  const courseLabel = config.term ? `${config.code} · ${config.term}` : config.code;
  const active = config.items.find((item) => item.key === config.activeKey);

  return (
    <Breadcrumb className="min-w-0 flex-1">
      <BreadcrumbList className="flex-nowrap">
        <AppBreadcrumbItem label={appName} href={appHref} />
        <BreadcrumbSeparator>›</BreadcrumbSeparator>
        <BreadcrumbItem className="min-w-0">
          {config.courseCrumb ? (
            config.courseCrumb
          ) : active ? (
            <BreadcrumbLink asChild>
              <NavAnchor href={config.href} className="truncate text-primary-text">
                {courseLabel}
              </NavAnchor>
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage className="truncate">{courseLabel}</BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {active && (
          <>
            <BreadcrumbSeparator>›</BreadcrumbSeparator>
            <BreadcrumbItem className="min-w-0">
              {config.subPage ? (
                <BreadcrumbLink asChild>
                  <NavAnchor href={active.href} className="truncate text-primary-text">
                    {active.label}
                  </NavAnchor>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage className="truncate text-muted-foreground">
                  {active.label}
                </BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </>
        )}
        {active && config.subPage && (
          <>
            <BreadcrumbSeparator>›</BreadcrumbSeparator>
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate text-muted-foreground">
                {config.subPage}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
