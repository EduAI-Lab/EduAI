import { cn } from "../utils";
import { NavAnchor, isNavHrefActive } from "./nav-shared";
import type { CourseNavConfig, SectionNavConfig } from "./types";

const LINK =
  "flex min-h-11 items-center border-l-[3px] border-transparent px-4 text-base text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const LINK_ACTIVE =
  "border-foreground bg-muted font-medium text-foreground hover:no-underline dark:bg-muted/40";

/** Default hover text for a course menu entry an admin policy switched off (#807). */
const DISABLED_REASON = "Turned off by your administrator.";

/**
 * The course menu: plain stacked links, Canvas-style. Each app builds the
 * hrefs (usually a `?tab=` on the course URL), so a section can be linked to,
 * reloaded, and reached with the back button.
 */
export function CourseNavMenu({
  config,
  onNavigate,
  showTerm = true,
  className,
}: {
  config: CourseNavConfig;
  /** Called when a link is chosen — the drawers use it to close themselves. */
  onNavigate?: () => void;
  showTerm?: boolean;
  className?: string;
}) {
  return (
    <nav aria-label="Course" className={className}>
      {showTerm && config.term && (
        <p className="px-4 pb-2 pt-4 text-xs italic text-muted-foreground">{config.term}</p>
      )}
      <ul className="flex flex-col">
        {config.items.map((item) => {
          const active = item.key === config.activeKey;
          return (
            <li key={item.key}>
              {item.disabled ? (
                <span
                  role="link"
                  aria-disabled="true"
                  title={item.disabledReason ?? DISABLED_REASON}
                  data-tour={item.tourId}
                  className={cn(
                    LINK,
                    "cursor-not-allowed text-muted-foreground hover:no-underline",
                  )}
                >
                  {item.label}
                </span>
              ) : (
                <NavAnchor
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  data-tour={item.tourId}
                  onClick={onNavigate}
                  className={cn(LINK, active && LINK_ACTIVE)}
                >
                  {item.label}
                </NavAnchor>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * A section's menu (e.g. Administration) in the course menu's column: the
 * same stacked links and active marker, plus each link's icon and trailing
 * badge (counts).
 */
export function SectionNavMenu({
  config,
  pathname,
  onNavigate,
  className,
}: {
  config: SectionNavConfig;
  pathname: string;
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <nav aria-label={config.title} className={className}>
      <p className="px-4 pb-2 pt-4 text-sm font-semibold">{config.title}</p>
      <ul className="flex flex-col">
        {config.links.map((link) => {
          const active =
            config.activeKey !== undefined
              ? link.key === config.activeKey
              : !link.external && isNavHrefActive(pathname, link.href);
          const icon = link.icon && (
            <link.icon size={18} aria-hidden="true" className="shrink-0 text-muted-foreground" />
          );
          return (
            <li key={link.key}>
              {link.disabled ? (
                <span
                  role="link"
                  aria-disabled="true"
                  title={link.disabledReason ?? DISABLED_REASON}
                  className={cn(
                    LINK,
                    "gap-3 cursor-not-allowed text-muted-foreground hover:no-underline",
                  )}
                >
                  {icon}
                  <span className="min-w-0 flex-1 truncate">{link.label}</span>
                </span>
              ) : (
                <NavAnchor
                  href={link.href}
                  external={link.external}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                  className={cn(LINK, "gap-3", active && LINK_ACTIVE)}
                >
                  {icon}
                  <span className="min-w-0 flex-1 truncate">{link.label}</span>
                  {link.badge}
                </NavAnchor>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
