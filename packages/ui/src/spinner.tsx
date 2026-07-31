import { IconLoader2 } from "@tabler/icons-react"

import { cn } from "./utils"

const SIZE_CLASSES = {
  xs: "size-3",
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
} as const

export interface SpinnerProps {
  size?: keyof typeof SIZE_CLASSES
  className?: string
  /**
   * Accessible label. Omit inside a button that already states what it is
   * doing ("Saving…"); the icon is then decorative and hidden from AT.
   */
  label?: string
}

/**
 * Inline busy indicator for buttons and section-level loading.
 *
 * Not a page loader — `PageLoader` is the full-viewport initial-auth state.
 * This replaces hand-rolled `animate-spin` icons that had drifted across two
 * different glyphs (`IconLoader` and `IconLoader2`) and several size spellings
 * (`h-4 w-4`, `size-4`, `size={20}`) for the same thing.
 */
export function Spinner({ size = "sm", className, label }: SpinnerProps) {
  return (
    <IconLoader2
      className={cn(SIZE_CLASSES[size], "animate-spin", className)}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  )
}
