"use client"

import * as React from "react"

import { cn } from "./utils"

export interface SegmentedControlOption<T extends string = string> {
  value: T
  label: React.ReactNode
  /** Accessible name when label is not plain text */
  ariaLabel?: string
}

export interface SegmentedControlProps<T extends string = string> {
  value: T
  onValueChange: (value: T) => void
  options: SegmentedControlOption<T>[]
  ariaLabel?: string
  className?: string
  size?: "sm" | "default"
}

/**
 * Apple-style segmented filter — high-contrast selected pill on a muted track.
 */
export function SegmentedControl<T extends string = string>({
  value,
  onValueChange,
  options,
  ariaLabel,
  className,
  size = "default",
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center rounded-xl border border-border bg-muted/55 p-1 gap-1 shadow-sm",
        className,
      )}
    >
      {options.map((option) => {
        const selected = value === option.value
        const labelText =
          typeof option.label === "string" ? option.label : option.ariaLabel ?? option.value

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.ariaLabel ?? labelText}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "relative rounded-lg font-medium transition-all duration-200 ease-out",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              size === "sm" ? "min-w-[4.5rem] px-3 py-1.5 text-xs" : "min-w-[5.25rem] px-4 py-2 text-sm",
              selected
                ? "bg-card text-foreground shadow-[0_1px_4px_rgba(0,0,0,0.08)] scale-[1.02]"
                : "text-muted-foreground hover:bg-card/75 hover:text-foreground hover:shadow-xs active:scale-[0.98]",
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
