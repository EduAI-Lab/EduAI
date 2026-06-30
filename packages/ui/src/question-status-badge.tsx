import { Badge } from "./ui/badge"

export type QuestionStatusVariant = "warning" | "success"

export interface QuestionStatus {
  label: string
  variant: QuestionStatusVariant
}

/**
 * Single source of truth for a question's review status. Drafts are `warning`
 * (needs review); reviewed questions are `success`. Use this for components that
 * take a `{ label, variant }` status object (e.g. QuestionCard); use
 * {@link QuestionStatusBadge} where you render the badge directly.
 */
export function questionStatus(isDraft: boolean): QuestionStatus {
  return isDraft
    ? { label: "Draft", variant: "warning" }
    : { label: "Reviewed", variant: "success" }
}

export interface QuestionStatusBadgeProps {
  isDraft: boolean
  size?: "sm" | "default" | "lg"
  className?: string
}

/** Canonical Draft / Reviewed badge for a question. */
export function QuestionStatusBadge({ isDraft, size = "default", className }: QuestionStatusBadgeProps) {
  const status = questionStatus(isDraft)
  return (
    <Badge variant={status.variant} size={size} className={className}>
      {status.label}
    </Badge>
  )
}
