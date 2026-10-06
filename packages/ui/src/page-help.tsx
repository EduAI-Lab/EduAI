import * as React from "react";
import { IconBook2, IconHelpCircle, IconRoute } from "@tabler/icons-react";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { cn } from "./utils";

/**
 * Page-level help copy shown by `PageHelpButton` (#1754). Each app owns a small
 * route-keyed registry of these; this component owns none of the wording.
 *
 * Distinct from the per-element `HelpHint` tooltips (#1051/#1052): this is the
 * one "what is this page and how do I use it" entry point in the header, and
 * its `helpHref` deep-links into the same `/help` sections those hints use.
 */
export interface PageHelpContent {
  /** Page name used as the modal heading, e.g. "Course materials". */
  title: string;
  /** One or two sentences on what the page is for. */
  summary: string;
  /** Short, practical tips for this page. */
  tips?: React.ReactNode[];
  /** Deep link into the app's full guide, e.g. `/help#materials`. Falls back to the button's `helpHref`. */
  helpHref?: string;
}

/** The guided-tour entry offered from the help modal. Omit when no tour exists for the viewer. */
export interface PageHelpTour {
  /** Button label. Defaults to "Take a tour". */
  label?: string;
  /** One line describing what the tour covers (or where it will take the viewer). */
  description?: string;
  /** Starts the tour. The modal closes first so the tour's overlay is never stacked under it. */
  onStart: () => void;
}

export interface PageHelpRoute {
  /** Exact pathname, or a pattern tested against it. First matching entry wins. */
  match: string | RegExp;
  content: PageHelpContent;
}

/** First registry entry matching `pathname`, else `fallback`. */
export function resolvePageHelp(
  pathname: string,
  routes: readonly PageHelpRoute[],
  fallback: PageHelpContent,
): PageHelpContent {
  const hit = routes.find(({ match }) =>
    match instanceof RegExp ? match.test(pathname) : match === pathname,
  );
  return hit?.content ?? fallback;
}

export interface PageHelpButtonProps {
  content: PageHelpContent;
  tour?: PageHelpTour | null;
  /** The app's full guide. Used when `content.helpHref` is not set. */
  helpHref?: string;
  /** Router link (e.g. react-router `Link`); receives both `to` and `href`, like the sidebar. */
  LinkComponent?: React.ElementType;
  /** Draws an attention dot on the trigger — e.g. QM nudging a user with no courses yet. */
  showIndicator?: boolean;
  className?: string;
}

/**
 * The (?) help trigger in the top-right of every page's header across Core,
 * AI Tutor and Question Maker (#1754). Opens a modal with contextual help for
 * the current page, a link into the full guide, and the guided tour when one is
 * on offer.
 */
export function PageHelpButton({
  content,
  tour,
  helpHref = "/help",
  LinkComponent = "a",
  showIndicator = false,
  className,
}: PageHelpButtonProps) {
  const [open, setOpen] = React.useState(false);
  const guideHref = content.helpHref ?? helpHref;
  const tips = content.tips ?? [];

  const handleStartTour = () => {
    if (!tour) return;
    setOpen(false);
    // Let Radix finish closing (and drop its focus trap / body pointer lock)
    // before the tour mounts its own overlay and grabs focus.
    window.setTimeout(tour.onStart, 0);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <span className="relative inline-flex">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Help for this page"
          aria-haspopup="dialog"
          title="Help"
          data-tour="page-help"
          data-tour-id="page-help"
          className={cn(
            "flex size-9 min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            className,
          )}
        >
          <IconHelpCircle size={18} aria-hidden="true" />
        </button>
        {showIndicator ? (
          <span
            className="pointer-events-none absolute -top-0.5 -right-0.5 flex size-3"
            aria-hidden="true"
          >
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex size-3 rounded-full bg-primary" />
          </span>
        ) : null}
      </span>

      <DialogContent className="sm:max-w-md" data-testid="page-help-dialog">
        <DialogHeader className="text-left">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Help for this page
          </p>
          <DialogTitle>{content.title}</DialogTitle>
          <DialogDescription>{content.summary}</DialogDescription>
        </DialogHeader>

        {tips.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Tips">
            {tips.map((tip, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-foreground">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden />
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {tour ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <IconRoute className="mt-0.5 size-4 shrink-0 text-primary-text" aria-hidden />
              <p className="text-sm text-muted-foreground">
                {tour.description ?? "Walk through the key parts of this screen step by step."}
              </p>
            </div>
            <Button type="button" size="sm" onClick={handleStartTour} className="shrink-0">
              {tour.label ?? "Take a tour"}
            </Button>
          </div>
        ) : null}

        <DialogFooter className="sm:justify-between">
          <Button asChild variant="outline" size="sm">
            <LinkComponent to={guideHref} href={guideHref} onClick={() => setOpen(false)}>
              <IconBook2 className="size-4" aria-hidden />
              Open full help guide
            </LinkComponent>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
