import * as React from "react";
import { IconBook2, IconInfoCircle } from "@tabler/icons-react";

import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "./utils";

/**
 * Progressive-help copy for one concept (#1051/#1052). Each app owns a typed
 * registry of these (e.g. `CORE_HELP`); this component owns none of the wording.
 */
export type HelpHintContent = {
  /** Concept name, used as the popover heading and the trigger's accessible name. */
  title: string;
  /** One short sentence shown on hover and keyboard focus. */
  summary: string;
  /** The longer explanation shown when the trigger is activated. */
  details: string;
  /** Deep link into the app's full guide, e.g. `/help#materials`. */
  href: string;
};

export type HelpHintProps = HelpHintContent & {
  /** Router link (e.g. react-router `Link`); receives both `to` and `href`, like `PageHelpButton`. */
  LinkComponent?: React.ElementType;
  /** Label for the full-guide link. */
  linkLabel?: string;
  side?: React.ComponentProps<typeof PopoverContent>["side"];
  align?: React.ComponentProps<typeof PopoverContent>["align"];
  className?: string;
};

/**
 * A small (i) button beside a confusing control: hover or focus shows the
 * summary, click / tap / Enter / Space opens the details with a link to the
 * matching `/help` section. Distinct from the page-level `PageHelpButton`.
 */
export function HelpHint({
  title,
  summary,
  details,
  href,
  LinkComponent = "a",
  linkLabel = "Read more in the help guide",
  side = "top",
  align = "center",
  className,
}: HelpHintProps) {
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const [tooltipOpen, setTooltipOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();
  // Returning focus to the trigger after the popover closes would otherwise
  // pop the summary tooltip straight back up over the content just dismissed.
  const suppressNextTooltipRef = React.useRef(false);
  const dismissedOutsideRef = React.useRef(false);
  const ignoreFocusOpenRef = React.useRef(false);

  const handleTooltipOpenChange = (open: boolean) => {
    if (open && suppressNextTooltipRef.current) {
      suppressNextTooltipRef.current = false;
      return;
    }
    if (open && ignoreFocusOpenRef.current) return;
    setTooltipOpen(open);
  };

  const handlePopoverOpenChange = (open: boolean) => {
    setPopoverOpen(open);
    if (open) setTooltipOpen(false);
  };

  return (
    <Popover open={popoverOpen} onOpenChange={handlePopoverOpenChange}>
      <Tooltip open={tooltipOpen && !popoverOpen} onOpenChange={handleTooltipOpenChange}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              ref={triggerRef}
              type="button"
              aria-label={`About ${title}`}
              data-slot="help-hint-trigger"
              onFocus={(event) => {
                // Programmatic focus after a click (e.g. a dialog's auto-focus) isn't
                // focus-visible; only keyboard focus should show the summary.
                if (event.currentTarget.matches(":focus-visible")) return;
                ignoreFocusOpenRef.current = true;
                queueMicrotask(() => {
                  ignoreFocusOpenRef.current = false;
                });
              }}
              className={cn(
                // The pseudo-element widens the touch target without shifting layout.
                "relative inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full align-middle text-muted-foreground transition-colors after:absolute after:-inset-2.5 after:content-[''] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:text-primary-text",
                className,
              )}
            >
              <IconInfoCircle className="size-4" aria-hidden="true" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          sideOffset={4}
          collisionPadding={16}
          className="max-w-[min(18rem,calc(100vw-2rem))]"
        >
          {summary}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side={side}
        align={align}
        collisionPadding={16}
        aria-labelledby={titleId}
        data-slot="help-hint-content"
        className="flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2 text-sm"
        onInteractOutside={() => {
          dismissedOutsideRef.current = true;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const trigger = triggerRef.current;
          if (!dismissedOutsideRef.current && trigger && document.activeElement !== trigger) {
            suppressNextTooltipRef.current = true;
            trigger.focus();
          }
          dismissedOutsideRef.current = false;
        }}
      >
        <p id={titleId} className="font-semibold text-foreground">
          {title}
        </p>
        <p className="leading-relaxed text-muted-foreground">{details}</p>
        <LinkComponent
          to={href}
          href={href}
          onClick={() => {
            // Leaving for the guide: don't yank focus (and scroll) back to the trigger.
            dismissedOutsideRef.current = true;
            setPopoverOpen(false);
          }}
          className="inline-flex items-center gap-1.5 self-start rounded-sm font-medium text-primary-text hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <IconBook2 className="size-4" aria-hidden="true" />
          {linkLabel}
        </LinkComponent>
      </PopoverContent>
    </Popover>
  );
}
