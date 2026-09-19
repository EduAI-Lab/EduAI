/**
 * 72-hour AI service history, grouped by server (#764 follow-on).
 *
 * Presentational only — each app fetches `/api/ai-status/history` its own way
 * and passes the decoded payload, exactly as AIServiceIndicators does.
 *
 * A bucket with no samples renders as `none`, visually distinct from
 * operational. Painting missing data as healthy is the failure this panel
 * exists to prevent, so "no data" is never green.
 */
import * as React from "react";

import type { ServiceStatus } from "./ai-service-indicators";
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
  uptimePct: number;
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

export interface AIServiceHistoryPanelProps {
  data: HistoryPayload | null;
  loading?: boolean;
  error?: string | null;
  stale?: boolean;
  checkedAt?: string | null;
  onRefresh?: () => void;
  /**
   * The fleet-wide verdict the UBC chip itself is showing. Rendered in the
   * header so an amber chip above green rows reads as an explanation rather
   * than a contradiction: this panel's job is to explain the chip, and it
   * cannot do that without stating what the chip says.
   */
  current?: ServiceStatus | null;
  /** Interval in minutes, used only in the cold-start copy. */
  coldStartMinutes?: number;
}

const BAR_CLASS = {
  operational: "bg-emerald-500",
  degraded: "bg-amber-500",
  outage: "bg-red-500",
  unknown: "bg-muted-foreground/40",
  none: "bg-muted-foreground/15",
} satisfies Record<HistoryBucketState | "none", string>;

const BAR_WORD = {
  operational: "Operational",
  degraded: "Degraded",
  outage: "Outage",
  unknown: "Unknown",
  none: "No data",
} satisfies Record<HistoryBucketState | "none", string>;

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

/** Chip-state words, including the one state a bucket can never be. */
const CURRENT_WORD = {
  ...BAR_WORD,
  loading: "Checking…",
} satisfies Record<HistoryBucketState | "none" | "loading", string>;

const CURRENT_DOT_CLASS = {
  ...BAR_CLASS,
  loading: "bg-amber-400 animate-pulse",
} satisfies Record<HistoryBucketState | "none" | "loading", string>;

function Bar({ bucket }: { bucket: HistoryBucket }) {
  const key = bucket.state ?? "none";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-bucket-state={key}
          // An unrecognised state must still paint something: falling through to
          // `undefined` left an invisible gap that reads as "no data".
          className={cn(
            "h-5 min-w-[2px] flex-1 rounded-[1px]",
            BAR_CLASS[key] ?? BAR_CLASS.unknown,
          )}
        />
      </TooltipTrigger>
      <TooltipContent side="top">
        {new Date(bucket.t).toLocaleString()} · {BAR_WORD[key] ?? BAR_WORD.unknown}
      </TooltipContent>
    </Tooltip>
  );
}

function ModelRow({
  model,
  windowHours,
  stale,
}: {
  model: HistoryModel;
  windowHours: number;
  stale: boolean;
}) {
  const newest = [...model.buckets].reverse().find((b) => b.state !== null)?.state ?? "unknown";
  // The newest non-null bucket is only "current" while the data is fresh. With
  // the probe worker dead ten hours it is a ten-hour-old reading, and saying
  // "currently operational" is the exact lie the stale banner exists to stop —
  // a sighted user sees the banner, so a screen-reader user must hear it.
  const currentPhrase = stale
    ? "current state unknown — status data is stale"
    : `currently ${(BAR_WORD[newest] ?? BAR_WORD.unknown).toLowerCase()}`;
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{model.label}</span>
      {/* One sentence per model; a screen reader must not announce 72 bars. */}
      <div
        className="flex flex-1 items-center gap-[1px]"
        aria-label={`${model.label}: ${model.uptimePct.toFixed(1)}% uptime over the last ${windowHours} hours, ${currentPhrase}`}
        role="img"
      >
        <span aria-hidden className="flex w-full items-center gap-[1px]">
          {model.buckets.map((bucket) => (
            <Bar key={bucket.t} bucket={bucket} />
          ))}
        </span>
      </div>
      <span className="w-12 shrink-0 text-right text-xs tabular-nums">
        {model.uptimePct.toFixed(1)}%
      </span>
    </div>
  );
}

export function AIServiceHistoryPanel({
  data,
  loading = false,
  error = null,
  stale = false,
  checkedAt = null,
  current = null,
  onRefresh,
  coldStartMinutes = 15,
}: AIServiceHistoryPanelProps) {
  const hasData = data != null && data.servers.length > 0;
  const currentState = current?.state ?? null;

  return (
    <div className="w-[min(90vw,26rem)] space-y-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">UBC-hosted AI</div>
          {currentState ? (
            <div
              className="flex items-center gap-1.5 text-xs"
              data-current-state={currentState}
              role="status"
            >
              <span
                aria-hidden
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  CURRENT_DOT_CLASS[currentState] ?? CURRENT_DOT_CLASS.unknown,
                )}
              />
              <span>{CURRENT_WORD[currentState] ?? CURRENT_WORD.unknown}</span>
              {current?.detail ? (
                <span className="truncate text-muted-foreground">· {current.detail}</span>
              ) : null}
            </div>
          ) : null}
          {checkedAt ? (
            <div className="text-xs text-muted-foreground">
              Last {data?.windowHours ?? 72} hours · checked {minutesAgo(checkedAt)} min ago
            </div>
          ) : null}
        </div>
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
          >
            Refresh
          </button>
        ) : null}
      </div>

      {stale ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs">
          Status data is stale
          {checkedAt ? ` — last checked ${minutesAgo(checkedAt)} minutes ago` : ""}.
        </div>
      ) : null}

      {error ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1 text-xs">
          <span className="text-muted-foreground">{error}</span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={!onRefresh}
            className="underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
          >
            Retry
          </button>
        </div>
      ) : null}

      {loading && !hasData ? (
        <div className="space-y-2" aria-label="Loading status history">
          <div className="h-5 animate-pulse rounded bg-muted" />
          <div className="h-5 animate-pulse rounded bg-muted" />
        </div>
      ) : null}

      {!loading && !hasData && !error ? (
        <div className="text-xs text-muted-foreground">
          No status history yet. The first check runs within {coldStartMinutes} minutes.
        </div>
      ) : null}

      {hasData
        ? data.servers.map((server) => (
            <div key={server.key} className="space-y-0.5">
              <div className="flex items-baseline justify-between text-xs">
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
                  windowHours={data.windowHours}
                  stale={stale}
                />
              ))}
            </div>
          ))
        : null}

      <div className="flex flex-wrap gap-3 border-t border-border pt-2 text-[10px] text-muted-foreground">
        {/* `unknown` paints its own grey and must be nameable; without an entry
            it was indistinguishable from "no data" to anyone reading the key. */}
        {(["operational", "degraded", "outage", "unknown", "none"] as const).map((key) => (
          <span key={key} className="inline-flex items-center gap-1">
            <span className={cn("h-2 w-2 rounded-[1px]", BAR_CLASS[key])} aria-hidden />
            {BAR_WORD[key]}
          </span>
        ))}
      </div>
    </div>
  );
}
