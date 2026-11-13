import * as React from "react";

/**
 * Props for a Tooltip wrapped around a menu or popover trigger. The tip stays
 * shut while the menu is open, and does not reopen when the menu hands focus
 * back to the trigger as it closes (Radix opens a tooltip on focus). Any pointer
 * or blur event on the trigger ends that suppression, so hover works as usual.
 *
 * `menuOpen` is the menu's own open state; spread `tooltipProps` on `Tooltip`
 * and `triggerProps` on the trigger button.
 */
export function useMenuTooltip(menuOpen: boolean) {
  const [tipOpen, setTipOpen] = React.useState(false);
  const restoringFocus = React.useRef(false);
  const wasOpen = React.useRef(false);

  React.useEffect(() => {
    if (menuOpen) setTipOpen(false);
    else if (wasOpen.current) restoringFocus.current = true;
    wasOpen.current = menuOpen;
  }, [menuOpen]);

  const endSuppression = () => {
    restoringFocus.current = false;
  };

  return {
    tooltipProps: {
      open: tipOpen && !menuOpen,
      onOpenChange: (next: boolean) => {
        if (next && (menuOpen || restoringFocus.current)) return;
        setTipOpen(next);
      },
    },
    triggerProps: {
      onPointerEnter: endSuppression,
      onPointerLeave: endSuppression,
      onBlur: endSuppression,
    },
  };
}
