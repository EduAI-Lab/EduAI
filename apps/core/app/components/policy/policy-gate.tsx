import * as React from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@eduai/ui"

import { usePolicies } from "~/hooks/api/use-policies"
import { policyDefault, type PolicyKey } from "~/lib/policy-flags"

export type { PolicyKey } from "~/lib/policy-flags"

/** Shown when an admin-disabled control is hovered. Keep generic — the flag's
 * full description is ADMIN-only, so we don't leak it to every role. */
export const DEFAULT_POLICY_DISABLED_MESSAGE = "Turned off by your administrator."

/**
 * Reads policy flag VALUES (available to any authenticated user via
 * `GET /api/policies`) so the UI can mirror backend enforcement. While the
 * values are still loading we report enabled, so controls never flicker from
 * enabled → disabled (and an admin-on flag isn't briefly greyed).
 */
export function usePolicyGate() {
  const { policies, isLoading } = usePolicies()
  const isEnabled = React.useCallback(
    (key: PolicyKey): boolean => {
      if (isLoading) return true
      return policies[key] ?? policyDefault(key)
    },
    [policies, isLoading],
  )
  return { isEnabled, isLoading }
}

interface DisabledTooltipProps {
  /** When true, force the child disabled and show the tooltip; otherwise pass through. */
  disabled: boolean
  /** Tooltip copy. */
  message?: string
  /** Tooltip side; defaults to "top". */
  side?: React.ComponentProps<typeof TooltipContent>["side"]
  /** A single interactive element (button, switch, tab trigger, …). */
  children: React.ReactElement
}

/**
 * Generic "greyed-out + tooltip" wrapper. When `disabled`, the child is forced
 * into its disabled state and wrapped in a hoverable span carrying an explanatory
 * tooltip — replacing the old "control just disappears" behavior (issue #807).
 * Use this when the disabled condition is compound (e.g. a tab that needs either
 * of two flags); use `PolicyTooltip` when it maps to a single flag.
 *
 * The child is cloned with `pointer-events-none` because a natively-disabled
 * element swallows its own hover events; the surrounding span is what surfaces
 * the tooltip (same approach as the chat composer's disabled toggles).
 */
export function DisabledTooltip({
  disabled,
  message = DEFAULT_POLICY_DISABLED_MESSAGE,
  side = "top",
  children,
}: DisabledTooltipProps) {
  if (!disabled) return children

  const child = children as React.ReactElement<{
    disabled?: boolean
    className?: string
    "aria-disabled"?: boolean
  }>
  const disabledChild = React.cloneElement(child, {
    disabled: true,
    "aria-disabled": true,
    className: [child.props.className, "pointer-events-none"]
      .filter(Boolean)
      .join(" "),
  })

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* opacity-60 greys custom children (the native `disabled` attr only
              dims real form controls); the span owns hover so the tooltip fires. */}
          <span className="inline-flex cursor-not-allowed opacity-60" tabIndex={0}>
            {disabledChild}
          </span>
        </TooltipTrigger>
        <TooltipContent side={side} className="max-w-[240px]">
          <p>{message}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

interface PolicyTooltipProps {
  /** The policy flag this control depends on. */
  flag: PolicyKey
  /** Override the default tooltip copy. */
  message?: string
  /** Tooltip side; defaults to "top". */
  side?: React.ComponentProps<typeof TooltipContent>["side"]
  /** A single interactive element (button, switch, tab trigger, …). */
  children: React.ReactElement
}

/**
 * Wraps a single control bound to one policy flag. When `flag` is ON (or still
 * loading) the child renders untouched; when OFF it is greyed-out with an
 * "admin turned this off" tooltip (issue #807).
 */
export function PolicyTooltip({
  flag,
  message = DEFAULT_POLICY_DISABLED_MESSAGE,
  side = "top",
  children,
}: PolicyTooltipProps) {
  const { isEnabled } = usePolicyGate()
  return (
    <DisabledTooltip disabled={!isEnabled(flag)} message={message} side={side}>
      {children}
    </DisabledTooltip>
  )
}
