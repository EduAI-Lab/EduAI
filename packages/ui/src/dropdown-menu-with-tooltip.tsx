/**
 * @file A dropdown menu whose icon-only trigger is named by a tooltip on hover,
 * for the ⋯ row and card menus. The tip stays shut while the menu is open and
 * does not reopen as the menu hands focus back (see `useMenuTooltip`).
 */
import * as React from "react";

import { DropdownMenu, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useMenuTooltip } from "./use-menu-tooltip";

export type DropdownMenuWithTooltipProps = Omit<
  React.ComponentProps<typeof DropdownMenu>,
  "open" | "children"
> & {
  tooltip: string;
  /** The icon-only button that opens the menu. */
  trigger: React.ReactElement;
  /** The menu's `DropdownMenuContent`. */
  children: React.ReactNode;
};

export function DropdownMenuWithTooltip({
  tooltip,
  trigger,
  children,
  onOpenChange,
  ...menuProps
}: DropdownMenuWithTooltipProps) {
  const [open, setOpen] = React.useState(false);
  const menuTip = useMenuTooltip(open);
  return (
    <DropdownMenu
      {...menuProps}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
    >
      <Tooltip {...menuTip.tooltipProps}>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild {...menuTip.triggerProps}>
            {trigger}
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
      {children}
    </DropdownMenu>
  );
}
