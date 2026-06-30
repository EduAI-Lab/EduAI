import { IconGitBranch, IconStar } from "@tabler/icons-react"

import { Badge } from "./ui/badge"
import { cn } from "./utils"

export interface VariantIdentity {
  /**
   * Id of the original/base question this question is a variant of. When `null`
   * or `undefined` the question is treated as the original (not a variant).
   */
  referenceId?: number | null
  /** Optional ordinal among siblings, e.g. `2` renders "Variant 2 of #4". */
  variantNumber?: number | null
}

/**
 * Single source of truth for variant wording across cards, dialogs and drawers.
 * Originals → "Original"; variants → "Variant of #4" or "Variant 2 of #4".
 */
export function variantLabel({ referenceId, variantNumber }: VariantIdentity): string {
  if (referenceId == null) return "Original"
  return variantNumber != null
    ? `Variant ${variantNumber} of #${referenceId}`
    : `Variant of #${referenceId}`
}

export interface VariantBadgeProps extends VariantIdentity {
  /** Render nothing for originals instead of an "Original" badge. Default false. */
  hideOriginal?: boolean
  size?: "sm" | "default" | "lg"
  className?: string
}

/**
 * Canonical badge for a question's variant identity. Variants get a git-branch
 * icon; originals get a star. Used everywhere a "Variant of #N" / "Original"
 * marker appears so wording and styling never drift between screens.
 */
export function VariantBadge({
  referenceId,
  variantNumber,
  hideOriginal = false,
  size = "default",
  className,
}: VariantBadgeProps) {
  const isVariant = referenceId != null
  if (!isVariant && hideOriginal) return null
  return (
    <Badge
      variant="outline"
      size={size}
      className={cn("gap-1", !isVariant && "border-primary/40 text-primary-text", className)}
    >
      {isVariant ? <IconGitBranch className="size-3.5" /> : <IconStar className="size-3.5" />}
      {variantLabel({ referenceId, variantNumber })}
    </Badge>
  )
}
