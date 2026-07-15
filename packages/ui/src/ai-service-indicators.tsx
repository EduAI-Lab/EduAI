/**
 * Dual AI-service status chips, shared across Core, QuestionMaker, and AI Tutor
 * (issue #764). Two independent chips — UBC-hosted and Cloud — each reporting its
 * OWN state; neither depends on the other. A chip reads online / offline / loading
 * / unknown from its own probe. Clicking either chip re-checks (optional).
 *
 * Presentational only: each app fetches status from its own endpoint and maps it
 * onto the `cloud` / `ubc` props, so the look and behaviour are identical
 * everywhere while the data source stays app-specific.
 */
import * as React from "react"
import { IconCloud } from "@tabler/icons-react"

import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip"
import { cn } from "./utils"

export type ServiceState = "online" | "offline" | "loading" | "unknown"

export interface ServiceStatus {
  state: ServiceState
  /** Tooltip text; a sensible default per state is used when omitted. */
  detail?: string
}

export interface AIServiceIndicatorsProps {
  cloud: ServiceStatus
  ubc: ServiceStatus
  /** Called when a chip is clicked — wire to a re-check. Omit for static display. */
  onRefresh?: () => void
  className?: string
}

const DOT_CLASS: Record<ServiceState, string> = {
  online: "bg-emerald-500",
  offline: "bg-red-500",
  loading: "bg-amber-400 animate-pulse",
  unknown: "bg-muted-foreground/40",
}

const STATE_WORD: Record<ServiceState, string> = {
  online: "Online",
  offline: "Offline",
  loading: "Checking…",
  unknown: "Unknown",
}

function Chip({
  label,
  status,
  active,
  onClick,
  children,
}: {
  label: string
  status: ServiceStatus
  active: boolean
  onClick?: () => void
  children: React.ReactNode
}) {
  const tip = status.detail ?? `${label} · ${STATE_WORD[status.state]}`
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={`${label}: ${STATE_WORD[status.state]}`}
          className={cn(
            "relative inline-flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card align-middle shadow-sm transition-colors hover:bg-muted",
            active ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {children}
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-card",
              DOT_CLASS[status.state],
            )}
            aria-hidden
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tip}</TooltipContent>
    </Tooltip>
  )
}

export function AIServiceIndicators({
  cloud,
  ubc,
  onRefresh,
  className,
}: AIServiceIndicatorsProps) {
  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <Chip label="UBC-hosted AI" status={ubc} active={ubc.state === "online"} onClick={onRefresh}>
        <span className="text-[9px] font-bold leading-none tracking-tight">UBC</span>
      </Chip>
      <Chip label="Cloud AI" status={cloud} active={cloud.state === "online"} onClick={onRefresh}>
        <IconCloud className="size-3.5" strokeWidth={1.75} />
      </Chip>
    </div>
  )
}
