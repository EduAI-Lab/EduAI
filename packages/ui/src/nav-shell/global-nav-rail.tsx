import * as React from "react";
import { IconChevronsLeft, IconChevronsRight } from "@tabler/icons-react";

import { Avatar } from "../avatar";
import { TooltipProvider } from "../ui/tooltip";
import { cn } from "../utils";
import {
  AppTile,
  NavAnchor,
  RailTooltip,
  activeTrayFor,
  currentLauncherApp,
  isNavHrefActive,
  launcherShortName,
  switchAppLabel,
} from "./nav-shared";
import {
  AccountTrayPanel,
  AdminTrayPanel,
  AppsTrayPanel,
  CoursesTrayPanel,
  HelpTrayPanel,
  NavTray,
  RAIL_WIDTH,
  TRAY_TITLES,
} from "./nav-trays";
import type { NavOpenTray, NavShellLink, NavShellModel } from "./types";

// Width and the label's visibility follow both the saved collapse choice
// (`data-collapsed`) and the tablet breakpoint (`max-lg:`), so the right rail
// paints on first load without waiting for JS to read the viewport.
const TILE =
  "relative mx-auto flex h-[70px] w-[76px] cursor-pointer flex-col items-center justify-center gap-1 rounded-md px-1 text-sidebar-foreground transition-colors duration-200 motion-reduce:transition-none hover:bg-[var(--color-sidebar-hover)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsed=true]/rail:h-12 group-data-[collapsed=true]/rail:w-12 max-lg:h-12 max-lg:w-12";
const TILE_ACTIVE = "bg-white text-sidebar hover:bg-white hover:text-sidebar";
// The app switcher replaces the logo: the current app's tile, with its short
// name underneath in labelled mode.
const APP_TILE =
  "relative mx-auto flex min-h-14 w-[76px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md px-1 py-1.5 text-sidebar-foreground transition-colors duration-200 motion-reduce:transition-none hover:bg-[var(--color-sidebar-hover)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsed=true]/rail:w-12 max-lg:w-12";
// Up to two lines, so a longer label ("Question Library") wraps as in Canvas
// instead of truncating.
const LABEL =
  "line-clamp-2 max-w-full break-words text-center text-[12px] leading-tight group-data-[collapsed=true]/rail:sr-only max-lg:sr-only";

export interface GlobalNavRailProps {
  model: NavShellModel;
  /** The saved collapse preference (desktop only; tablet is always icon-only). */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** True when the rail is icon-only for any reason — drives tooltips and the tray offset. */
  iconOnly: boolean;
  openTray: NavOpenTray | null;
  onOpenTrayChange: (tray: NavOpenTray | null) => void;
  /** The Help tray's "Report a bug"; omitted when the app takes no bug reports. */
  onReportBug?: () => void;
}

/**
 * Canvas-style global navigation: a narrow navy rail with the icon stacked
 * over a short label. The top tile is the current app and opens the app
 * switcher; Account, Courses, Administration and Help open a flyout
 * tray; the rest navigate. Hidden below 768px, where the mobile header and
 * drawer take over.
 */
export function GlobalNavRail({
  model,
  collapsed,
  onCollapsedChange,
  iconOnly,
  openTray,
  onOpenTrayChange,
  onReportBug,
}: GlobalNavRailProps) {
  const activeTray = activeTrayFor(model);
  const currentApp = currentLauncherApp(model);
  const railWidth = iconOnly ? RAIL_WIDTH.iconOnly : RAIL_WIDTH.full;

  const trayProps = (tray: NavOpenTray, title: string) => ({
    tray,
    title,
    open: openTray === tray,
    onOpenChange: (open: boolean) => onOpenTrayChange(open ? tray : null),
    railWidth,
    tooltip: iconOnly ? title : undefined,
  });

  const trayTrigger = (tray: NavOpenTray, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      data-nav-tray-trigger={tray}
      className={cn(TILE, (activeTray === tray || openTray === tray) && TILE_ACTIVE)}
    >
      {icon}
      <span className={LABEL}>{label}</span>
    </button>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <nav
        aria-label="Global"
        // Core's chat "focus mode" hides the rail through this hook (assistive-active-highlight.css).
        data-sidebar="sidebar"
        data-collapsed={collapsed}
        className="group/rail sticky top-0 z-50 hidden h-svh w-[84px] shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 motion-reduce:transition-none data-[collapsed=true]:w-14 md:flex max-lg:w-14"
      >
        <div className="flex shrink-0 justify-center py-1.5">
          <NavTray
            {...trayProps("apps", TRAY_TITLES.apps)}
            // Always tooltipped: in labelled mode the tile shows the app's name,
            // not what choosing it does.
            tooltip={TRAY_TITLES.apps}
            trigger={
              <button
                type="button"
                data-nav-tray-trigger="apps"
                aria-label={switchAppLabel(currentApp)}
                className={cn(
                  APP_TILE,
                  openTray === "apps" && "bg-[var(--color-sidebar-hover)] text-white",
                )}
              >
                <AppTile app={currentApp} size={36} badge />
                <span className={LABEL}>{launcherShortName(currentApp)}</span>
              </button>
            }
          >
            <AppsTrayPanel model={model} />
          </NavTray>
        </div>

        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden py-1">
          <li>
            <NavTray
              {...trayProps("account", TRAY_TITLES.account)}
              trigger={trayTrigger(
                "account",
                "Account",
                <span aria-hidden="true">
                  <Avatar
                    name={model.user.name}
                    src={model.user.image ?? undefined}
                    size={28}
                    radius={14}
                    className="ring-2 ring-white/70"
                  />
                </span>,
              )}
            >
              <AccountTrayPanel model={model} />
            </NavTray>
          </li>
          {model.entries.map((entry) => {
            if (entry.kind === "link") {
              return (
                <li key={entry.link.key}>
                  <RailLink link={entry.link} pathname={model.pathname} iconOnly={iconOnly} />
                </li>
              );
            }
            const icon = <entry.icon size={26} strokeWidth={1.6} aria-hidden="true" />;
            if (entry.kind === "panel") {
              const tray = `panel:${entry.key}` as const;
              return (
                <li key={tray}>
                  <NavTray
                    {...trayProps(tray, entry.label)}
                    trigger={trayTrigger(tray, entry.label, icon)}
                  >
                    {entry.render(() => onOpenTrayChange(null))}
                  </NavTray>
                </li>
              );
            }
            return (
              <li key={entry.tray}>
                <NavTray
                  {...trayProps(entry.tray, TRAY_TITLES[entry.tray])}
                  trigger={trayTrigger(entry.tray, entry.label, icon)}
                >
                  {entry.tray === "courses" ? (
                    <CoursesTrayPanel model={model} open={openTray === "courses"} />
                  ) : entry.tray === "admin" ? (
                    <AdminTrayPanel model={model} />
                  ) : (
                    <HelpTrayPanel model={model} onReportBug={onReportBug} />
                  )}
                </NavTray>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={() => onCollapsedChange(!collapsed)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          className="mx-auto mb-2 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-foreground hover:bg-[var(--color-sidebar-hover)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring max-lg:hidden"
        >
          {collapsed ? (
            <IconChevronsRight size={20} aria-hidden="true" />
          ) : (
            <IconChevronsLeft size={20} aria-hidden="true" />
          )}
        </button>
      </nav>
    </TooltipProvider>
  );
}

function RailLink({
  link,
  pathname,
  iconOnly,
}: {
  link: NavShellLink;
  pathname: string;
  iconOnly: boolean;
}) {
  const active = !link.external && isNavHrefActive(pathname, link.href);
  const body = (
    <>
      {link.icon && <link.icon size={26} strokeWidth={1.6} aria-hidden="true" />}
      <span className={LABEL}>{link.label}</span>
    </>
  );

  if (link.disabled) {
    // #807: visible so users know the feature exists, but inert.
    return (
      <RailTooltip label={link.disabledReason ?? link.label} enabled>
        <span
          role="link"
          aria-disabled="true"
          tabIndex={0}
          className={cn(TILE, "cursor-not-allowed opacity-50 hover:bg-transparent")}
        >
          {body}
        </span>
      </RailTooltip>
    );
  }

  return (
    <RailTooltip label={link.label} enabled={iconOnly}>
      <NavAnchor
        href={link.href}
        external={link.external}
        onClick={link.onClick}
        aria-current={active ? "page" : undefined}
        className={cn(TILE, active && TILE_ACTIVE)}
      >
        {body}
      </NavAnchor>
    </RailTooltip>
  );
}
