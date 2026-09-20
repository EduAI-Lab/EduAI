/**
 * 72-hour AI service history, grouped by server (#764 follow-on).
 *
 * Presentational only — each app fetches `/api/ai-status/history` its own way
 * and passes the decoded payload, exactly as AIServiceIndicators does.
 *
 * The bars, rows and legend live in `ai-service-history-rows.tsx`, shared with
 * Core's full `/status` page. This file is the popover wrapper around them:
 * header verdict, freshness, stale banner, error and cold-start copy.
 */
import * as React from "react";

import type { ServiceStatus } from "./ai-service-indicators";
import {
  HISTORY_STATE_CLASS,
  HISTORY_STATE_WORD,
  HistoryLegend,
  HistoryServerSection,
  type HistoryBucket,
  type HistoryBucketState,
  type HistoryModel,
  type HistoryPayload,
  type HistoryServer,
} from "./ai-service-history-rows";
import { cn } from "./utils";

export type { HistoryBucket, HistoryBucketState, HistoryModel, HistoryPayload, HistoryServer };

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

/** Chip-state words, including the one state a bucket can never be. */
const CURRENT_WORD = {
  ...HISTORY_STATE_WORD,
  loading: "Checking…",
} satisfies Record<HistoryBucketState | "none" | "loading", string>;

const CURRENT_DOT_CLASS = {
  ...HISTORY_STATE_CLASS,
  loading: "bg-amber-400 animate-pulse",
} satisfies Record<HistoryBucketState | "none" | "loading", string>;

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
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
            <HistoryServerSection
              key={server.key}
              server={server}
              windowHours={data.windowHours}
              stale={stale}
              dense
            />
          ))
        : null}

      <HistoryLegend />
    </div>
  );
}
