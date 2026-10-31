import { cn } from "../utils";
import { NavAnchor } from "./nav-shared";
import type { CourseNavConfig } from "./types";

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
