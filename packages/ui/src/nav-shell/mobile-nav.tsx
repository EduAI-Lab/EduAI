import * as React from "react";
import { IconBug, IconMenu2, IconX } from "@tabler/icons-react";

import { Avatar } from "../avatar";
import { RoleBadge } from "../role-badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";
import { cn } from "../utils";
import { CourseNavMenu } from "./course-nav-menu";
import {
  AppSwitcherList,
  AppTile,
  LogoutButton,
  NavAnchor,
  currentLauncherApp,
  ThemeSwitchIcon,
  isNavHrefActive,
  launcherShortName,
  switchAppLabel,
  useNavCourses,
  useThemeSwitch,
} from "./nav-shared";
import type { CourseNavConfig, NavShellLink, NavShellModel, NavTrayKey } from "./types";

const ROW =
  "flex min-h-12 w-full items-center gap-3 px-4 text-left text-[15px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:bg-muted aria-[current=page]:font-semibold";
const SUB_ROW =
  "flex min-h-11 w-full items-center gap-3 py-1 pl-12 pr-4 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-[current=page]:bg-muted aria-[current=page]:font-semibold";
const ACTION =
  "flex min-h-14 min-w-11 flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-md px-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A left swipe at least this long (px), and more sideways than vertical, closes the drawer. */
const SWIPE_CLOSE_DISTANCE = 60;

export interface MobileNavProps {
  model: NavShellModel;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseNav?: CourseNavConfig;
  onReportBug?: () => void;
}

/**
 * Below 768px the rail is gone: a fixed navy header carries the hamburger, the
 * current app (which opens the app switcher as a bottom sheet), the page
 * title, and the user's avatar, and the hamburger opens a modal drawer
 * holding every rail destination and tray action (trays become accordions),
 * plus the course menu on course pages. Radix Dialog supplies the focus trap,
 * the body scroll lock, Escape/backdrop dismissal, and focus return to the
 * hamburger.
 */
export function MobileNav({
  model,
  title,
  open,
  onOpenChange,
  courseNav,
  onReportBug,
}: MobileNavProps) {
  const close = () => onOpenChange(false);
  const swipeStart = React.useRef<{ x: number; y: number } | null>(null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-2 bg-sidebar px-1 text-white md:hidden">
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label="Open navigation menu"
            className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-[var(--color-sidebar-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <IconMenu2 size={24} aria-hidden="true" />
          </button>
        </SheetTrigger>
        <MobileAppSwitcher model={model} />
        <p className="min-w-0 flex-1 truncate text-center text-base font-semibold">{title}</p>
        <button
          type="button"
          aria-label="Open account menu"
          onClick={() => onOpenChange(true)}
          className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Avatar
            name={model.user.name}
            src={model.user.image ?? undefined}
            size={32}
            radius={16}
          />
        </button>
      </header>

      <SheetContent
        side="left"
        aria-modal="true"
        className="w-[85vw] max-w-[320px] touch-pan-y gap-0 overflow-y-auto overscroll-contain p-0 sm:max-w-[320px] data-[state=closed]:duration-200 data-[state=open]:duration-200 motion-reduce:!animate-none [&>button:last-child]:hidden"
        // `touch-pan-y` keeps a sideways drag with us instead of the browser,
        // so a left swipe reaches pointerup rather than pointercancel.
        onPointerDown={(event) => {
          if (event.pointerType === "mouse") return;
          swipeStart.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerCancel={() => {
          swipeStart.current = null;
        }}
        onPointerUp={(event) => {
          const start = swipeStart.current;
          swipeStart.current = null;
          if (!start) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (dx <= -SWIPE_CLOSE_DISTANCE && Math.abs(dx) > Math.abs(dy)) close();
        }}
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Main navigation and account actions</SheetDescription>
        <SheetClose
          aria-label="Close navigation menu"
          className="absolute right-1 top-1 flex size-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <IconX size={20} aria-hidden="true" />
        </SheetClose>

        <DrawerAccount model={model} onNavigate={close} />
        <DrawerNav model={model} onNavigate={close} onReportBug={onReportBug} />

        {courseNav && courseNav.items.length > 0 && (
          <section aria-label="Course menu" className="border-t pb-4">
            <p className="px-4 pt-4 text-sm font-semibold">{courseNav.code}</p>
            {courseNav.term && (
              <p className="px-4 text-xs italic text-muted-foreground">{courseNav.term}</p>
            )}
            <CourseNavMenu
              config={courseNav}
              showTerm={false}
              onNavigate={close}
              className="pt-2"
            />
          </section>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * The header's current-app button. It opens the app list as a bottom sheet —
 * a separate modal from the drawer, so switching apps is one tap from any page.
 */
function MobileAppSwitcher({ model }: { model: NavShellModel }) {
  const currentApp = currentLauncherApp(model);
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={switchAppLabel(currentApp)}
          className="flex h-11 min-w-0 max-w-[40%] shrink cursor-pointer items-center gap-2 rounded-md px-1.5 hover:bg-[var(--color-sidebar-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <AppTile app={currentApp} size={28} badge />
          <span className="truncate text-sm font-semibold">{launcherShortName(currentApp)}</span>
        </button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="max-h-[85svh] gap-0 overflow-y-auto rounded-t-xl p-0 pb-[env(safe-area-inset-bottom)] data-[state=closed]:duration-200 data-[state=open]:duration-200 motion-reduce:!animate-none [&>button:last-child]:hidden"
      >
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <SheetTitle className="text-lg">Switch app</SheetTitle>
          <SheetClose
            aria-label="Close Switch app menu"
            className="-mr-2 flex size-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconX size={20} aria-hidden="true" />
          </SheetClose>
        </div>
        <SheetDescription className="sr-only">Choose an EduAI app to open</SheetDescription>
        <div className="p-3">
          <AppSwitcherList apps={model.launcherApps} currentAppId={model.currentAppId} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DrawerAccount({ model, onNavigate }: { model: NavShellModel; onNavigate: () => void }) {
  const { user } = model;
  const theme = useThemeSwitch();

  return (
    <div className="border-b px-3 pb-3 pt-4">
      <div className="flex items-center gap-3 pr-10">
        <Avatar name={user.name} src={user.image ?? undefined} size={44} radius={22} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{user.name}</p>
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          {user.role === "ADMIN" && <RoleBadge role="ADMIN" className="mt-1" />}
        </div>
      </div>
      <div className="mt-3 flex items-stretch justify-between gap-1">
        <button type="button" className={ACTION} onClick={theme.toggle}>
          <ThemeSwitchIcon isDark={theme.isDark} />
          {theme.label}
        </button>
        {model.accountLinks.map((link) => (
          <NavAnchor
            key={link.key}
            href={link.href}
            external={link.external}
            onClick={onNavigate}
            className={ACTION}
          >
            {link.icon && <link.icon size={18} aria-hidden="true" />}
            {link.label}
          </NavAnchor>
        ))}
        <LogoutButton
          onLogout={model.onLogout}
          className={cn(ACTION, "text-destructive hover:bg-destructive/10")}
        />
      </div>
    </div>
  );
}

function DrawerSubLinks({
  links,
  pathname,
  onNavigate,
}: {
  links: NavShellLink[];
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <>
      {links.map((link) => (
        <li key={link.key}>
          {link.disabled ? (
            <span
              role="link"
              aria-disabled="true"
              title={link.disabledReason}
              className={cn(SUB_ROW, "cursor-not-allowed opacity-50 hover:bg-transparent")}
            >
              {link.label}
            </span>
          ) : (
            <NavAnchor
              href={link.href}
              external={link.external}
              onClick={onNavigate}
              aria-current={
                !link.external && isNavHrefActive(pathname, link.href) ? "page" : undefined
              }
              className={SUB_ROW}
            >
              <span className="min-w-0 flex-1 truncate">{link.label}</span>
              {link.badge}
            </NavAnchor>
          )}
        </li>
      ))}
    </>
  );
}

function DrawerNav({
  model,
  onNavigate,
  onReportBug,
}: {
  model: NavShellModel;
  onNavigate: () => void;
  onReportBug?: () => void;
}) {
  const [expanded, setExpanded] = React.useState<string[]>([]);
  const courses = useNavCourses(model, expanded.includes("courses"));
  const { pathname } = model;

  const accordionTrigger = (label: string, icon: React.ReactNode) => (
    <AccordionTrigger className="min-h-12 items-center gap-3 rounded-none px-4 py-0 text-[15px] font-normal hover:bg-muted hover:no-underline focus-visible:ring-inset [&>svg]:translate-y-0 [&>svg]:motion-reduce:transition-none">
      <span className="flex flex-1 items-center gap-3">
        {icon}
        {label}
      </span>
    </AccordionTrigger>
  );

  const trayItem = (
    tray: Exclude<NavTrayKey, "account" | "apps">,
    label: string,
    icon: React.ReactNode,
  ) => (
    <AccordionItem key={tray} value={tray} className="border-b-0">
      {accordionTrigger(label, icon)}
      <AccordionContent className="pb-1">
        {tray === "courses" ? (
          <ul>
            {courses.status === "loading" && (
              <li className="py-2 pl-12 text-sm text-muted-foreground">Loading…</li>
            )}
            {courses.status === "error" && (
              <li className="py-2 pl-12 text-sm text-destructive">Couldn't load your courses.</li>
            )}
            {courses.courses.map((course) => (
              <li key={course.id}>
                <NavAnchor
                  href={course.href}
                  onClick={onNavigate}
                  aria-current={isNavHrefActive(pathname, course.href) ? "page" : undefined}
                  className={cn(SUB_ROW, "flex-col items-start justify-center gap-0")}
                >
                  <span className="max-w-full truncate">{course.code}</span>
                  <span className="max-w-full truncate text-xs text-muted-foreground">
                    {course.name}
                    {course.subtitle && ` · ${course.subtitle}`}
                  </span>
                </NavAnchor>
              </li>
            ))}
            {model.coursesHref && (
              <li>
                <NavAnchor
                  href={model.coursesHref}
                  onClick={onNavigate}
                  className={cn(SUB_ROW, "text-primary-text")}
                >
                  All courses
                </NavAnchor>
              </li>
            )}
          </ul>
        ) : tray === "admin" ? (
          <ul>
            <DrawerSubLinks links={model.adminLinks} pathname={pathname} onNavigate={onNavigate} />
          </ul>
        ) : (
          <ul>
            <DrawerSubLinks links={model.helpLinks} pathname={pathname} onNavigate={onNavigate} />
            {onReportBug && (
              <li>
                <button
                  type="button"
                  className={cn(SUB_ROW, "cursor-pointer")}
                  onClick={() => {
                    onNavigate();
                    onReportBug();
                  }}
                >
                  <IconBug size={16} aria-hidden="true" />
                  Report a bug
                </button>
              </li>
            )}
          </ul>
        )}
      </AccordionContent>
    </AccordionItem>
  );

  return (
    <nav aria-label="Global" className="py-2">
      <Accordion type="multiple" value={expanded} onValueChange={setExpanded}>
        {model.entries.map((entry) => {
          if (entry.kind === "panel") {
            return (
              <AccordionItem key={entry.key} value={`panel:${entry.key}`} className="border-b-0">
                {accordionTrigger(
                  entry.label,
                  <entry.icon size={20} strokeWidth={1.75} aria-hidden="true" />,
                )}
                <AccordionContent className="pb-1">{entry.render(onNavigate)}</AccordionContent>
              </AccordionItem>
            );
          }
          if (entry.kind === "tray") {
            return trayItem(
              entry.tray,
              entry.label,
              <entry.icon size={20} strokeWidth={1.75} aria-hidden="true" />,
            );
          }
          return (
            <DrawerLink
              key={entry.link.key}
              link={entry.link}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          );
        })}
      </Accordion>
    </nav>
  );
}

function DrawerLink({
  link,
  pathname,
  onNavigate,
}: {
  link: NavShellLink;
  pathname: string;
  onNavigate: () => void;
}) {
  const icon = link.icon && <link.icon size={20} strokeWidth={1.75} aria-hidden="true" />;
  if (link.disabled) {
    return (
      <span
        role="link"
        aria-disabled="true"
        title={link.disabledReason}
        className={cn(ROW, "cursor-not-allowed opacity-50 hover:bg-transparent")}
      >
        {icon}
        {link.label}
      </span>
    );
  }
  return (
    <NavAnchor
      href={link.href}
      external={link.external}
      onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
        link.onClick?.(event);
        onNavigate();
      }}
      aria-current={!link.external && isNavHrefActive(pathname, link.href) ? "page" : undefined}
      className={ROW}
    >
      {icon}
      {link.label}
    </NavAnchor>
  );
}
