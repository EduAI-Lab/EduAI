/**
 * Pieces shared by the desktop trays and the mobile drawer, so the two never
 * drift on what an action does — only on how it is laid out.
 */
import * as React from "react";
import { IconApps, IconLogout, IconMoon, IconSun } from "@tabler/icons-react";

import type { LauncherApp } from "../app-launcher";
import { useTheme } from "../theme-provider";
import { SheetClose } from "../ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../utils";
import type {
  NavLinkComponent,
  NavShellCoursesState,
  NavShellLink,
  NavShellModel,
  NavTrayKey,
} from "./types";

const NavLinkContext = React.createContext<NavLinkComponent>("a");

/** Supplies the app's router link to every nav piece below it. */
export function NavLinkProvider({
  LinkComponent,
  children,
}: {
  LinkComponent: NavLinkComponent;
  children: React.ReactNode;
}) {
  return <NavLinkContext.Provider value={LinkComponent}>{children}</NavLinkContext.Provider>;
}

type NavAnchorProps = Omit<React.ComponentPropsWithoutRef<"a">, "href"> & {
  href: string;
  /** Leaves the app: always a plain anchor, never the router link. */
  external?: boolean;
};

/** An in-app link through the app's router, or a plain anchor for `external` ones. */
export function NavAnchor({ href, external, ...props }: NavAnchorProps) {
  const LinkComponent = React.useContext(NavLinkContext);
  if (external) return <a href={href} {...props} />;
  return <LinkComponent to={href} href={href} {...props} />;
}

/** True when `href` is the current page or one of its sub-pages. */
export function isNavHrefActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function anyActive(pathname: string, links: NavShellLink[]): boolean {
  return links.some((link) => !link.external && isNavHrefActive(pathname, link.href));
}

/** Which tray entry owns the current page, for the rail's active tile. */
export function activeTrayFor(model: NavShellModel): NavTrayKey | null {
  const { pathname } = model;
  if (anyActive(pathname, model.accountLinks)) return "account";
  if (model.coursesHref && isNavHrefActive(pathname, model.coursesHref)) return "courses";
  if (anyActive(pathname, model.helpLinks)) return "help";
  if (anyActive(pathname, model.adminLinks)) return "admin";
  return null;
}

/**
 * The Courses tray / accordion list: the model's preloaded `courses` when it
 * has them, otherwise `loadCourses` on first open rather than on every page —
 * the rail is on every route, and most visits never open the tray. A failed
 * load lets a later open retry instead of pinning the error for the session.
 */
export function useNavCourses(model: NavShellModel, enabled: boolean): NavShellCoursesState {
  const [state, setState] = React.useState<NavShellCoursesState>({ status: "idle", courses: [] });
  const requested = React.useRef(false);
  // The loader is usually an inline closure; read the latest without refiring.
  const loadRef = React.useRef(model.loadCourses);
  loadRef.current = model.loadCourses;
  const preloaded = model.courses;

  React.useEffect(() => {
    const load = loadRef.current;
    if (preloaded || !load || !enabled || requested.current) return;
    requested.current = true;
    setState({ status: "loading", courses: [] });
    load().then(
      (courses) => setState({ status: "ready", courses }),
      () => {
        requested.current = false;
        setState({ status: "error", courses: [] });
      },
    );
  }, [enabled, preloaded]);

  return preloaded ?? state;
}

/**
 * Light/dark switch with a visible label. Like the header's ThemeToggle, it
 * shows a fixed state until mount so the first client render matches the
 * server's markup.
 */
export type ThemeSwitch = {
  isDark: boolean;
  toggle: () => void;
  /** What choosing the switch turns on ("Dark mode" / "Light mode"). */
  label: string;
};

export function useThemeSwitch(): ThemeSwitch {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const isDark = mounted && resolvedTheme === "dark";
  return {
    isDark,
    toggle: () => setTheme(isDark ? "light" : "dark"),
    label: isDark ? "Light mode" : "Dark mode",
  };
}

export function ThemeSwitchIcon({ isDark }: { isDark: boolean }) {
  return isDark ? (
    <IconSun size={18} aria-hidden="true" />
  ) : (
    <IconMoon size={18} aria-hidden="true" />
  );
}

export function LogoutButton({
  onLogout,
  className,
}: {
  onLogout: () => void;
  className?: string;
}) {
  return (
    <button type="button" onClick={onLogout} className={className}>
      <IconLogout size={18} aria-hidden="true" />
      Log out
    </button>
  );
}

/** The model's current app, if the launcher list carries it. */
export function currentLauncherApp(model: NavShellModel): LauncherApp | undefined {
  return model.launcherApps.find((app) => app.id === model.currentAppId);
}

/** "Core", "AI Tutor", … for the rail tile and the mobile header. */
export function launcherShortName(app: LauncherApp | undefined): string {
  return app?.shortName ?? app?.name ?? "Apps";
}

/** The switcher trigger's accessible name; it contains the visible short name. */
export function switchAppLabel(app: LauncherApp | undefined): string {
  return app ? `Switch app, current app: ${app.name}` : "Switch app";
}

/**
 * An app's icon on its brand-coloured tile. The launcher registry sizes its
 * icons for a 32px menu row, so the tile scales the glyph to fit. `badge` adds
 * the small grid marker that says "this opens the app switcher".
 */
export function AppTile({
  app,
  size,
  badge = false,
}: {
  app: LauncherApp | undefined;
  size: number;
  badge?: boolean;
}) {
  const glyph = Math.round(size * 0.55);
  return (
    <span
      aria-hidden="true"
      className="relative flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: size / 4,
        background: app?.color ?? "var(--primary)",
      }}
    >
      <span
        className="flex items-center justify-center text-white [&_svg]:!h-[var(--glyph)] [&_svg]:!w-[var(--glyph)] [&_svg]:!text-white"
        style={{ "--glyph": `${glyph}px` } as React.CSSProperties}
      >
        {app?.icon ?? <IconApps />}
      </span>
      {badge && (
        <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-white text-sidebar shadow-sm ring-1 ring-black/10 [&_svg]:!size-2.5 [&_svg]:!text-sidebar">
          <IconApps strokeWidth={2.5} />
        </span>
      )}
    </span>
  );
}

/**
 * The app switcher's list, shared by the rail's Switch app tray and the mobile
 * bottom sheet. The current app is listed (so the list reads as "you are
 * here") but is not a link; choosing another app closes the surrounding sheet.
 */
export function AppSwitcherList({
  apps,
  currentAppId,
}: {
  apps: LauncherApp[];
  currentAppId: string;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {apps.map((app) => {
        const isCurrent = app.id === currentAppId;
        const body = (
          <>
            <AppTile app={app} size={40} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[15px] font-semibold text-foreground">{app.name}</span>
              {app.description && (
                <span className="line-clamp-2 text-xs text-muted-foreground">
                  {app.description}
                </span>
              )}
            </span>
            {isCurrent && (
              <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-border">
                Current
              </span>
            )}
          </>
        );
        const row = "flex min-h-14 items-center gap-3 rounded-lg px-3 py-2";
        return (
          <li key={app.id}>
            {isCurrent ? (
              <span aria-current="page" className={cn(row, "bg-muted")}>
                {body}
              </span>
            ) : (
              <SheetClose asChild>
                <a
                  href={app.url}
                  className={cn(
                    row,
                    "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                >
                  {body}
                </a>
              </SheetClose>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A right-side tooltip for an icon-only rail entry. With `enabled` false it
 * returns the child untouched, so the visible label is the only name source.
 */
export function RailTooltip({
  label,
  enabled,
  children,
}: {
  label: string;
  enabled: boolean;
  children: React.ReactElement;
}) {
  if (!enabled) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
