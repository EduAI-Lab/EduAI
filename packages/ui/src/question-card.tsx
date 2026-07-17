import type { CSSProperties, ReactNode } from "react"
import {
  IconListDetails,
  IconSparkles,
  IconHistory,
  IconDots,
} from "@tabler/icons-react"

import { cn } from "./utils"
import { Badge } from "./ui/badge"
import { AnswerOption } from "./answer-option"

export type QuestionDifficulty = "easy" | "medium" | "hard"

export interface QuestionCardChoice {
  /** Letter label e.g. "A" */
  letter: string
  /** Choice body text */
  text: string
  /** Marks this choice as the correct answer */
  correct?: boolean
}

export interface QuestionCardStatus {
  label: string
  /** Maps to Badge variant; defaults to "success" (Reviewed) */
  variant?: "success" | "warning" | "muted" | "outline" | "default"
}

export interface QuestionCardProps {
  /** Question type label e.g. "Multiple Choice" */
  type: string
  /** Optional override for the type icon (defaults to a list icon) */
  typeIcon?: ReactNode
  /** Difficulty label e.g. "Medium" */
  difficulty?: string
  /** Difficulty colour mapping (easy=success, medium=warning, hard=destructive) */
  difficultyLevel?: QuestionDifficulty
  /** Show the "AI" chip when the question was AI-generated */
  ai?: boolean
  /** Muted label on the top-right e.g. "Variant #2 of Question #5" */
  label?: string
  /** Prominent identity marker rendered top-left, ahead of the type/difficulty badges. */
  identity?: ReactNode
  /** Review/publish status pill on the top-right */
  status?: QuestionCardStatus
  /** The question prompt */
  question: ReactNode
  /** MCQ choices — rendered as a responsive grid */
  choices?: QuestionCardChoice[]
  /** For SA/LA questions: rendered in place of the choice grid */
  answer?: ReactNode
  /** Topic tags shown in the footer */
  topics?: string[]
  /** Footer right-aligned timestamp e.g. "Updated 2 days ago" */
  updatedLabel?: string
  /** History icon-button handler; hidden when omitted */
  onHistory?: () => void
  /** Rendered inside the kebab (⋮) slot — pass a DropdownMenu trigger or buttons */
  menu?: ReactNode
  /** "default" full card, "compact" for dense lists (e.g. Question Bank) */
  size?: "default" | "compact"
  /** Makes the whole card clickable (e.g. to open the question). Controls in the header stop propagation. */
  onClick?: () => void
  className?: string
  style?: CSSProperties
}

const difficultyVariant: Record<QuestionDifficulty, "success" | "warning" | "destructive"> = {
  easy: "success",
  medium: "warning",
  hard: "destructive",
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  )
}

export function QuestionCard({
  type,
  typeIcon,
  difficulty,
  difficultyLevel = "medium",
  ai,
  label,
  identity,
  status,
  question,
  choices,
  answer,
  topics = [],
  updatedLabel,
  onHistory,
  menu,
  size = "default",
  onClick,
  className,
  style,
}: QuestionCardProps) {
  const compact = size === "compact"

  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      className={cn(
        "@container/qcard flex flex-col rounded-[var(--radius-xl)] border border-border bg-card text-card-foreground shadow-[var(--shadow-2xs)]",
        compact ? "p-4" : "p-6 md:p-7",
        onClick &&
          "cursor-pointer transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      style={style}
    >
      {/* Header: wraps when the card gets narrow. On wide cards (≥24rem) status/controls hug the
          end via ml-auto; on narrow cards (e.g. the composer's live-preview column) they drop the
          right-pin and flow/wrap left under the badges instead of clipping off the edge. The type
          label also collapses to an icon below 20rem to keep the row compact for as long as possible. */}
      <div className="flex flex-wrap items-center gap-2">
        {identity && (
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-md bg-accent px-2 py-0.5 font-semibold text-accent-foreground",
                compact ? "text-xs" : "text-[13px]",
              )}
            >
              {identity}
            </span>
          )}
          <Badge variant="muted" size={compact ? "sm" : "default"} className="shrink-0 gap-1.5" title={type}>
            {typeIcon ?? <IconListDetails className="size-3.5" />}
            <span className="hidden @[20rem]/qcard:inline">{type}</span>
          </Badge>
          {difficulty && (
            <Badge variant={difficultyVariant[difficultyLevel]} size={compact ? "sm" : "default"}>
              {difficulty}
            </Badge>
          )}
          {ai && (
            <Badge
              size={compact ? "sm" : "default"}
              className="gap-1 border-transparent"
              style={{
                background: "var(--color-blue-100)",
                color: "var(--color-blue-700)",
              }}
            >
              <IconSparkles className="size-3.5" />
              AI
            </Badge>
          )}

        <div
          className="ml-0 flex shrink-0 items-center gap-2 @[24rem]/qcard:ml-auto"
          onClick={onClick ? (event) => event.stopPropagation() : undefined}
        >
          {label && (
            <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
          )}
          {status && (
            <Badge variant={status.variant ?? "success"} size={compact ? "sm" : "default"}>
              {status.label}
            </Badge>
          )}
          {onHistory && (
            <IconButton label="View history" onClick={onHistory}>
              <IconHistory className="size-[18px]" />
            </IconButton>
          )}
          {menu}
        </div>
      </div>

      {/* Body: question + choices, with the left accent rail */}
      <div className={cn("mt-4 flex flex-1 flex-col border-l-2 border-border pl-4", compact && "mt-3 pl-3")}>
        <div
          className={cn(
            "font-semibold leading-snug text-foreground",
            compact ? "text-sm" : "text-base md:text-lg",
          )}
        >
          {question}
        </div>

        {choices && choices.length > 0 && (
          <div
            className={cn(
              "mt-4 grid gap-3",
              compact ? "grid-cols-1 gap-2" : "grid-cols-1 @[26rem]/qcard:grid-cols-2",
            )}
          >
            {choices.map((choice) => (
              <AnswerOption
                key={choice.letter}
                letter={choice.letter}
                letterVariant="plain"
                size={compact ? "compact" : "default"}
                state={choice.correct ? "correct" : "default"}
              >
                {choice.text}
              </AnswerOption>
            ))}
          </div>
        )}

        {!choices?.length && (
          <div
            className={cn(
              "mt-4 flex w-full flex-1 break-words rounded-[var(--radius-lg)] border px-4 py-3",
              answer
                ? "border-border bg-muted/40 text-foreground"
                : "items-center justify-center border-dashed border-border bg-muted/20 text-sm italic text-muted-foreground",
            )}
          >
            {answer ?? "No answer provided"}
          </div>
        )}
      </div>

      {/* Footer: topics + timestamp */}
      {(topics.length > 0 || updatedLabel) && (
        <div className={cn("mt-5 flex flex-col gap-2 border-t border-border @[26rem]/qcard:flex-row @[26rem]/qcard:items-center @[26rem]/qcard:justify-between", compact ? "pt-3" : "pt-4")}>
          <div className="flex min-w-0 flex-wrap gap-2">
            {topics.map((topic) => (
              <Badge key={topic} variant="muted" size={compact ? "sm" : "default"} className="max-w-full font-medium">
                <span className="truncate">{topic}</span>
              </Badge>
            ))}
          </div>
          {updatedLabel && (
            <span className="shrink-0 text-[13px] text-muted-foreground">{updatedLabel}</span>
          )}
        </div>
      )}
    </div>
  )
}
