/**
 * The bars, model rows and legend shared by the AI-status popover panel and
 * Core's full `/status` page (#764 follow-on).
 *
 * These live here rather than inside `ai-service-history-panel.tsx` so the two
 * surfaces cannot drift apart on the rules that make the history honest: a
 * bucket with no samples is grey and never green, an unmeasurable uptime reads
 * `n/a` and never 0%, and stale data never claims a current state. A second
 * copy of that vocabulary on the page would be a second place to get it wrong.
 *
 * Presentational only — no fetching, no router. `dense` picks the popover's
 * compact scale; the page renders the same rows roomy.
 */
import * as React from "react";

import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";
import { cn } from "./utils";

export type HistoryBucketState = "operational" | "degraded" | "outage" | "unknown";

export interface HistoryBucket {
  t: string;
  state: HistoryBucketState | null;
}

export interface HistoryModel {
  key: string;
  label: string;
  /**
   * Percentage of judgeable buckets that were up, or null when none were —
   * `unknown` hours are excluded from the denominator, so a model whose every
   * sample was "we could not tell" has no uptime to report. Rendered as "n/a"
   * rather than as 0%, which would read as total downtime.
   */
  uptimePct: number | null;
  buckets: HistoryBucket[];
}

export interface HistoryServer {
  key: string;
  label: string;
  waiting: number | null;
  cacheUsage: number | null;
  models: HistoryModel[];
}

export interface HistoryPayload {
  windowHours: number;
  bucketMinutes: number;
  generatedAt: string;
  servers: HistoryServer[];
}

export const HISTORY_STATE_CLASS = {
  operational: "bg-emerald-500",
  degraded: "bg-amber-500",
  outage: "bg-red-500",
  unknown: "bg-muted-foreground/40",
  none: "bg-muted-foreground/15",
} satisfies Record<HistoryBucketState | "none", string>;

export const HISTORY_STATE_WORD = {
  operational: "Operational",
  degraded: "Degraded",
  outage: "Outage",
  unknown: "Unknown",
  none: "No data",
} satisfies Record<HistoryBucketState | "none", string>;

/** Every state a bar can paint, in severity order, for the legend. */
const LEGEND_KEYS = ["operational", "degraded", "outage", "unknown", "none"] as const;

function Bar({ bucket, dense }: { bucket: HistoryBucket; dense: boolean }) {
  const key = bucket.state ?? "none";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-bucket-state={key}
          // An unrecognised state must still paint something: falling through to
          // `undefined` left an invisible gap that reads as "no data".
          className={cn(
            "min-w-[2px] flex-1 rounded-[1px]",
            dense ? "h-5" : "h-9",
            HISTORY_STATE_CLASS[key] ?? HISTORY_STATE_CLASS.unknown,
          )}
        />
      </TooltipTrigger>
      <TooltipContent side="top">
        {new Date(bucket.t).toLocaleString()} ·{" "}
        {HISTORY_STATE_WORD[key] ?? HISTORY_STATE_WORD.unknown}
      </TooltipContent>
    </Tooltip>
  );
}

function ModelRow({
  model,
  windowHours,
  stale,
  dense,
}: {
  model: HistoryModel;
  windowHours: number;
  stale: boolean;
  dense: boolean;
}) {
  const newest = [...model.buckets].reverse().find((b) => b.state !== null)?.state ?? "unknown";
  // The newest non-null bucket is only "current" while the data is fresh. With
  // the probe worker dead ten hours it is a ten-hour-old reading, and saying
  // "currently operational" is the exact lie the stale banner exists to stop —
  // a sighted user sees the banner, so a screen-reader user must hear it.
  const currentPhrase = stale
    ? "current state unknown — status data is stale"
    : `currently ${(HISTORY_STATE_WORD[newest] ?? HISTORY_STATE_WORD.unknown).toLowerCase()}`;
  const uptimeText = model.uptimePct == null ? "n/a" : `${model.uptimePct.toFixed(1)}%`;
  const uptimePhrase =
    model.uptimePct == null
      ? `no uptime recorded over the last ${windowHours} hours`
      : `${model.uptimePct.toFixed(1)}% uptime over the last ${windowHours} hours`;
  return (
    <div className={cn("flex items-center gap-2", dense ? "py-1" : "py-1.5")}>
      <span
        className={cn(
          "shrink-0 truncate text-muted-foreground",
          dense ? "w-28 text-xs" : "w-44 text-sm",
        )}
      >
        {model.label}
      </span>
      {/* One sentence per model; a screen reader must not announce 72 bars. */}
      <div
        className="flex flex-1 items-center gap-[1px]"
        aria-label={`${model.label}: ${uptimePhrase}, ${currentPhrase}`}
        role="img"
      >
        <span aria-hidden className="flex w-full items-center gap-[1px]">
          {model.buckets.map((bucket) => (
            <Bar key={bucket.t} bucket={bucket} dense={dense} />
          ))}
        </span>
      </div>
      <span
        className={cn("shrink-0 text-right tabular-nums", dense ? "w-12 text-xs" : "w-16 text-sm")}
      >
        {uptimeText}
      </span>
    </div>
  );
}

export interface HistoryServerSectionProps {
  server: HistoryServer;
  windowHours: number;
  stale: boolean;
  dense?: boolean;
}

/** One host and its models. `dense` is the popover scale; the page passes false. */
export function HistoryServerSection({
  server,
  windowHours,
  stale,
  dense = true,
}: HistoryServerSectionProps) {
  return (
    <div className={dense ? "space-y-0.5" : "space-y-1"}>
      <div className={cn("flex items-baseline justify-between", dense ? "text-xs" : "text-sm")}>
        <span className="font-medium">{server.label}</span>
        <span className="text-muted-foreground">
          {server.waiting != null ? `queue ${server.waiting}` : "queue n/a"}
          {server.cacheUsage != null ? ` · ${Math.round(server.cacheUsage * 100)}%` : ""}
        </span>
      </div>
      {server.models.map((model) => (
        <ModelRow
          key={model.key}
          model={model}
          windowHours={windowHours}
          stale={stale}
          dense={dense}
        />
      ))}
    </div>
  );
}

export interface HistoryLegendProps {
  className?: string;
}

/**
 * `unknown` paints its own grey and must be nameable; without an entry it was
 * indistinguishable from "no data" to anyone reading the key.
 */
export function HistoryLegend({ className }: HistoryLegendProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap gap-3 border-t border-border pt-2 text-[10px] text-muted-foreground",
        className,
      )}
    >
      {LEGEND_KEYS.map((key) => (
        <span key={key} className="inline-flex items-center gap-1">
          <span className={cn("h-2 w-2 rounded-[1px]", HISTORY_STATE_CLASS[key])} aria-hidden />
          {HISTORY_STATE_WORD[key]}
        </span>
      ))}
    </div>
  );
}
