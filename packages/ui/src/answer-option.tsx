import type { ReactNode } from "react"
import { IconCircleCheckFilled, IconCircleXFilled } from "@tabler/icons-react"

import { cn } from "./utils"

/**
 * Visual state of a single lettered answer choice.
 * - `default`   — not chosen
 * - `selected`  — chosen by the learner, not yet graded (interactive)
 * - `correct`   — the right answer (green)
 * - `incorrect` — a wrong answer the learner picked (red)
 *
 * `correct`/`incorrect` deliberately use the success/error palettes rather than
 * brand tokens — a learner reads green = right, red = wrong faster than any
 * design-system colour. This mirrors QuestionMaker's `QuestionCard` correct marker.
 */
export type AnswerOptionState = "default" | "selected" | "correct" | "incorrect"

export interface AnswerOptionProps {
  /** Letter label e.g. "A". */
  letter: string
  /** Choice body. */
  children: ReactNode
  /** Visual state. Defaults to `default`. */
  state?: AnswerOptionState
  /** Letter presentation: a boxed chip (interactive players) or plain text (dense preview cards). */
  letterVariant?: "chip" | "plain"
  /** Density. `compact` matches QuestionCard's dense rows. */
  size?: "default" | "compact"
  /** When provided the row is interactive (button + `role="radio"`) and calls back on choose. */
  onSelect?: () => void
  /** ARIA checked state for the interactive radio. Defaults to `state === "selected"`. */
  selected?: boolean
  disabled?: boolean
  className?: string
}

const containerByState: Record<AnswerOptionState, string> = {
  default: "border-border bg-muted/40",
  selected: "border-secondary bg-secondary/10 ring-1 ring-inset ring-secondary",
  correct: "border-[var(--color-success-500)] bg-[var(--color-success-100)]",
  incorrect: "border-destructive/50 bg-destructive/10",
}

const chipByState: Record<AnswerOptionState, string> = {
  default: "bg-muted text-muted-foreground",
  selected: "bg-secondary text-secondary-foreground",
  correct: "bg-[var(--color-success-500)] text-white",
  incorrect: "bg-destructive text-destructive-foreground",
}

const plainByState: Record<AnswerOptionState, string> = {
  default: "text-muted-foreground",
  selected: "text-secondary",
  correct: "text-[var(--color-success-700)]",
  incorrect: "text-destructive",
}

/**
 * Canonical lettered answer choice shared by AI-Tutor's lesson player and
 * QuestionMaker's preview card. Renders as a static row for previews or an
 * interactive radio when `onSelect` is passed.
 */
export function AnswerOption({
  letter,
  children,
  state = "default",
  letterVariant = "chip",
  size = "default",
  onSelect,
  selected,
  disabled,
  className,
}: AnswerOptionProps) {
  const interactive = typeof onSelect === "function"
  const compact = size === "compact"

  const container = cn(
    "flex w-full items-start gap-3 rounded-[var(--radius-lg)] border text-left transition-colors",
    compact ? "px-4 py-2.5" : "px-4 py-3.5",
    containerByState[state],
    // Interactive default rows lift to the card surface with a hover cue; graded
    // states keep their semantic fill.
    interactive && state === "default" && "bg-card hover:bg-muted/40",
    interactive && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    interactive && !disabled && "cursor-pointer",
    disabled && "cursor-default",
    className,
  )

  const letterNode =
    letterVariant === "chip" ? (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md font-bold",
          compact ? "size-6 text-xs" : "size-8 text-sm",
          chipByState[state],
        )}
        aria-hidden="true"
      >
        {letter}
      </span>
    ) : (
      <span className={cn("shrink-0 font-semibold", plainByState[state])} aria-hidden="true">
        {letter}
      </span>
    )

  const body = (
    <>
      {letterNode}
      <span className="min-w-0 flex-1 break-words self-center text-foreground">{children}</span>
      {state === "correct" && (
        <IconCircleCheckFilled className="mt-0.5 size-5 shrink-0 text-[var(--color-success-500)]" />
      )}
      {state === "incorrect" && (
        <IconCircleXFilled className="mt-0.5 size-5 shrink-0 text-destructive" />
      )}
    </>
  )

  if (!interactive) {
    return <div className={container}>{body}</div>
  }

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected ?? state === "selected"}
      aria-label={`Option ${letter}`}
      disabled={disabled}
      onClick={onSelect}
      className={container}
    >
      {body}
    </button>
  )
}
