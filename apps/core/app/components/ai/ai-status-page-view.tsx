/**
 * The full AI-service status page (#764 follow-on).
 *
 * The roomy sibling of the header chip's popover: same payload, same bars, same
 * honesty rules — they come from `HistoryServerSection` in `@eduai/ui`, shared
 * with the panel precisely so the two surfaces cannot disagree about what a
 * grey bar means.
 *
 * Presentational only. The route loader does the reading, so this renders with
 * data already in hand and never shows a spinner on first paint.
 */
import {
  HistoryLegend,
  HistoryServerSection,
  HISTORY_STATE_CLASS,
  HISTORY_STATE_WORD,
  cn,
  type HistoryPayload,
  type ServiceState,
  type ServiceStatus,
} from "@eduai/ui";

/** Chip states plus the one a persisted bucket can never be. */
const STATE_WORD = {
  ...HISTORY_STATE_WORD,
  loading: "Checking…",
} satisfies Record<ServiceState | "none", string>;

const STATE_DOT = {
  ...HISTORY_STATE_CLASS,
  loading: "bg-amber-400 animate-pulse",
} satisfies Record<ServiceState | "none", string>;

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

export interface AiStatusPageViewProps {
  payload: HistoryPayload;
  /** The fleet-wide UBC verdict — the same one the header chip shows. */
  ubc: ServiceStatus;
  /**
   * The managed-cloud verdict. Rendered as a single line, never as bars:
   * `ai_service_samples` records UBC hosts only, so there is no cloud history
   * and the page must not imply otherwise.
   */
  cloud: ServiceStatus;
  checkedAt: string | null;
  stale: boolean;
  onRefresh?: () => void;
}

export function AiStatusPageView({
  payload,
  ubc,
  cloud,
  checkedAt,
  stale,
  onRefresh,
}: AiStatusPageViewProps) {
  const hasHistory = payload.servers.length > 0;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2" data-current-state={ubc.state} role="status">
              <span
                aria-hidden
                className={cn(
                  "h-3 w-3 shrink-0 rounded-full",
                  STATE_DOT[ubc.state] ?? STATE_DOT.unknown,
                )}
              />
              <h2 className="text-lg font-semibold">
                UBC-hosted AI · {STATE_WORD[ubc.state] ?? STATE_WORD.unknown}
              </h2>
              {ubc.detail ? (
                <span className="text-sm text-muted-foreground">· {ubc.detail}</span>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              Last {payload.windowHours} hours
              {checkedAt ? ` · checked ${minutesAgo(checkedAt)} min ago` : ""}
            </p>
          </div>
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Refresh
            </button>
          ) : null}
        </div>

        <div
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="cloud-status"
        >
          <span
            aria-hidden
            className={cn(
              "h-2.5 w-2.5 shrink-0 rounded-full",
              STATE_DOT[cloud.state] ?? STATE_DOT.unknown,
            )}
          />
          <span>
            Managed cloud AI · {STATE_WORD[cloud.state] ?? STATE_WORD.unknown}
            {cloud.detail ? ` · ${cloud.detail}` : ""}
          </span>
        </div>

        {stale ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            Status data is stale
            {checkedAt ? ` — last checked ${minutesAgo(checkedAt)} minutes ago` : ""}. The readings
            below are the last ones recorded, not the current state.
          </div>
        ) : null}
      </header>

      {hasHistory ? (
        <div className="space-y-6">
          {payload.servers.map((server) => (
            <section key={server.key} className="rounded-lg border border-border p-4">
              <HistoryServerSection
                server={server}
                windowHours={payload.windowHours}
                stale={stale}
                dense={false}
              />
            </section>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          No status history yet. The probe writes a sample on each run; the first check runs within
          one polling interval.
        </p>
      )}

      <HistoryLegend className="text-xs" />
    </div>
  );
}
