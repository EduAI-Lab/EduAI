import * as React from "react";
import { IconBug, IconX } from "@tabler/icons-react";

import { Avatar } from "../avatar";
import { RoleBadge } from "../role-badge";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "../ui/sheet";
import { cn } from "../utils";
import {
  AppSwitcherList,
  LogoutButton,
  NavAnchor,
  RailTooltip,
  ThemeSwitchIcon,
  isNavHrefActive,
  useNavCourses,
  useThemeSwitch,
} from "./nav-shared";
import type { NavShellLink, NavShellModel, NavTrayKey } from "./types";

export const TRAY_TITLES = {
  account: "Account",
  apps: "Switch app",
  courses: "Courses",
  admin: "Administration",
  help: "Help",
} satisfies Record<NavTrayKey, string>;

/** Rail width each mode leaves for the tray to slide out beside. */
export const RAIL_WIDTH = { full: 84, iconOnly: 56 } as const;

const TRAY_LINK =
  "flex min-h-11 items-center gap-3 rounded-md px-3 text-[15px] text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:font-semibold aria-[current=page]:text-foreground";
const ACCOUNT_ROW =
  "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-left text-[15px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * One flyout tray: a non-modal dialog beside the rail. It overlays the page
 * (never pushes it), takes focus when it opens, hands focus back to its rail
 * trigger when it closes, and closes on Escape, an outside click, or its X —
 * all Radix Dialog behaviour. `trigger` is the rail button, which becomes the
 * dialog's trigger (aria-expanded / aria-controls come with it).
 */
export function NavTray({
  tray,
  open,
  onOpenChange,
  railWidth,
  tooltip,
  trigger,
  children,
}: {
  tray: NavTrayKey;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  railWidth: number;
  /** Shown beside the trigger while the rail is icon-only. */
  tooltip?: string;
  trigger: React.ReactElement;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <RailTooltip label={tooltip ?? ""} enabled={Boolean(tooltip)}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
      </RailTooltip>
      <SheetContent
        side="left"
        data-nav-tray={tray}
        style={{ left: railWidth }}
        className="z-40 w-[300px] max-w-[85vw] gap-0 overflow-y-auto border-r-0 p-0 shadow-xl dark:border-r sm:max-w-[300px] data-[state=closed]:duration-200 data-[state=open]:duration-200 motion-reduce:!animate-none [&>button:last-child]:hidden"
      >
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
          <SheetTitle className="text-lg">{TRAY_TITLES[tray]}</SheetTitle>
          <SheetClose
            aria-label={`Close ${TRAY_TITLES[tray]} menu`}
            className="-mr-2 flex size-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <IconX size={20} aria-hidden="true" />
          </SheetClose>
        </div>
        <SheetDescription className="sr-only">{`${TRAY_TITLES[tray]} navigation`}</SheetDescription>
        <div className="flex flex-col gap-1 p-3">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

/** A tray's list of plain links (Administration, Help). */
function TrayLinkList({ links, pathname }: { links: NavShellLink[]; pathname: string }) {
  return (
    <>
      {links.map((link) => (
        <li key={link.key}>
          {link.disabled ? (
            <span
              role="link"
              aria-disabled="true"
              title={link.disabledReason}
              className={cn(
                TRAY_LINK,
                "cursor-not-allowed text-muted-foreground hover:no-underline",
              )}
            >
              {link.icon && <link.icon size={18} aria-hidden="true" className="shrink-0" />}
              <span className="min-w-0 flex-1 truncate">{link.label}</span>
            </span>
          ) : (
            <NavAnchor
              href={link.href}
              external={link.external}
              aria-current={
                !link.external && isNavHrefActive(pathname, link.href) ? "page" : undefined
              }
              className={TRAY_LINK}
            >
              {link.icon && (
                <link.icon
                  size={18}
                  aria-hidden="true"
                  className="shrink-0 text-muted-foreground"
                />
              )}
              <span className="min-w-0 flex-1 truncate">{link.label}</span>
              {link.badge}
            </NavAnchor>
          )}
        </li>
      ))}
    </>
  );
}

export function AccountTrayPanel({ model }: { model: NavShellModel }) {
  const { user } = model;
  const theme = useThemeSwitch();

  return (
    <>
      <div className="flex flex-col items-center gap-2 px-2 pb-3 pt-1 text-center">
        <Avatar name={user.name} src={user.image ?? undefined} size={64} radius={32} />
        <div className="min-w-0 max-w-full">
          <p className="truncate font-semibold">{user.name}</p>
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
        </div>
        {user.role === "ADMIN" && <RoleBadge role="ADMIN" />}
      </div>
      {model.accountLinks.map((link) => (
        <NavAnchor key={link.key} href={link.href} external={link.external} className={ACCOUNT_ROW}>
          {link.icon && <link.icon size={18} aria-hidden="true" />}
          {link.label}
        </NavAnchor>
      ))}
      <button type="button" className={ACCOUNT_ROW} onClick={theme.toggle}>
        <ThemeSwitchIcon isDark={theme.isDark} />
        {theme.label}
      </button>
      <div className="mt-2 border-t pt-2">
        <LogoutButton
          onLogout={model.onLogout}
          className={`${ACCOUNT_ROW} text-destructive hover:bg-destructive/10`}
        />
      </div>
    </>
  );
}

/** The Switch app tray: every app the user may open, the current one marked. */
export function AppsTrayPanel({ model }: { model: NavShellModel }) {
  return <AppSwitcherList apps={model.launcherApps} currentAppId={model.currentAppId} />;
}

export function CoursesTrayPanel({ model, open }: { model: NavShellModel; open: boolean }) {
  const { status, courses } = useNavCourses(model, open);

  return (
    <>
      {status === "loading" && <p className="px-3 py-2 text-sm text-muted-foreground">Loading…</p>}
      {status === "error" && (
        <p className="px-3 py-2 text-sm text-destructive">Couldn't load your courses.</p>
      )}
      {status === "ready" && courses.length === 0 && (
        <p className="px-3 py-2 text-sm text-muted-foreground">No courses yet.</p>
      )}
      {courses.length > 0 && (
        <ul className="flex flex-col">
          {courses.map((course) => (
            <li key={course.id}>
              <NavAnchor
                href={course.href}
                aria-current={isNavHrefActive(model.pathname, course.href) ? "page" : undefined}
                className="flex min-h-11 flex-col justify-center rounded-md px-3 py-1.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-muted"
              >
                <span className="truncate text-[15px] text-primary-text">{course.code}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {course.name}
                  {course.subtitle && ` · ${course.subtitle}`}
                </span>
              </NavAnchor>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 border-t pt-2">
        <NavAnchor href={model.coursesHref} className={TRAY_LINK}>
          All courses
        </NavAnchor>
      </div>
    </>
  );
}

export function AdminTrayPanel({ model }: { model: NavShellModel }) {
  return (
    <ul className="flex flex-col">
      <TrayLinkList links={model.adminLinks} pathname={model.pathname} />
    </ul>
  );
}

export function HelpTrayPanel({
  model,
  onReportBug,
}: {
  model: NavShellModel;
  /** Set when the app takes bug reports; the shell closes the tray first. */
  onReportBug?: () => void;
}) {
  return (
    <ul className="flex flex-col">
      <TrayLinkList links={model.helpLinks} pathname={model.pathname} />
      {onReportBug && (
        <li>
          <button
            type="button"
            onClick={onReportBug}
            className={`${TRAY_LINK} w-full cursor-pointer text-left`}
          >
            <IconBug size={18} aria-hidden="true" className="shrink-0 text-muted-foreground" />
            Report a bug
          </button>
        </li>
      )}
    </ul>
  );
}
