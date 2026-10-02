/**
 * The one mapping from an AI-service state to how it is painted and named.
 *
 * The header chips (`ai-service-indicators.tsx`) and the 72-hour history bars
 * (`ai-service-history-rows.tsx`) answer different questions and so have
 * different key sets — a chip can be `loading`, a history bucket can hold no
 * data at all — but they describe the SAME four states, and a user reading the
 * popover next to the chip is entitled to see one vocabulary. Kept here so a
 * restyle (the degraded amber, say) is one edit rather than two that can drift.
 *
 * Each surface spreads these and adds only the key that is genuinely its own.
 */

/** The states both surfaces share, independent of how either one was reached. */
export type SharedServiceState = "operational" | "degraded" | "outage" | "unknown";

/** Dot / bar fill per shared state. */
export const SHARED_STATE_CLASS = {
  operational: "bg-emerald-500",
  // Steady amber, distinct from the pulsing amber `loading` dot the chips add.
  degraded: "bg-amber-500",
  outage: "bg-red-500",
  unknown: "bg-muted-foreground/40",
} satisfies Record<SharedServiceState, string>;

/** Human-readable label per shared state. */
export const SHARED_STATE_WORD = {
  operational: "Operational",
  degraded: "Degraded",
  outage: "Outage",
  unknown: "Unknown",
} satisfies Record<SharedServiceState, string>;
