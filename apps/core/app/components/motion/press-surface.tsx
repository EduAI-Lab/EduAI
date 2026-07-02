import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@eduai/ui";

import { useMotionReducedPreference } from "~/components/assistive/ui-preferences-provider";

type PressSurfaceProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  /** Selected / launching state — brief accent glow before action fires */
  launching?: boolean;
  /** Fade sibling chips while one is launching */
  dimmed?: boolean;
};

/**
 * Subtle press + launch feedback for chips and toolbar controls.
 * Respects reduced-motion preference (instant state, no scale).
 */
export function PressSurface({
  children,
  className,
  launching = false,
  dimmed = false,
  disabled,
  onClick,
  ...props
}: PressSurfaceProps) {
  const motionReduced = useMotionReducedPreference();
  const [pressed, setPressed] = useState(false);

  const motionClass = motionReduced
    ? ""
    : cn(
        "transition-[transform,opacity,box-shadow,background-color,border-color] duration-200 ease-[cubic-bezier(0.34,1.2,0.64,1)]",
        pressed && !disabled && "scale-[0.96]",
        launching && "z-10 scale-[1.03] border-accent/60 bg-accent/15 shadow-[0_0_0_1px_color-mix(in_oklch,var(--accent)_35%,transparent),0_8px_24px_-6px_color-mix(in_oklch,var(--accent)_25%,transparent)]",
        dimmed && "pointer-events-none scale-[0.98] opacity-0",
      );

  return (
    <button
      type="button"
      {...props}
      disabled={disabled}
      onPointerDown={(event) => {
        if (!motionReduced && !disabled) setPressed(true);
        props.onPointerDown?.(event);
      }}
      onPointerUp={(event) => {
        setPressed(false);
        props.onPointerUp?.(event);
      }}
      onPointerLeave={(event) => {
        setPressed(false);
        props.onPointerLeave?.(event);
      }}
      onClick={onClick}
      className={cn(className, motionClass)}
    >
      {children}
    </button>
  );
}
