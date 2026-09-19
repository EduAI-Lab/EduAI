/**
 * Env configuration for the AI status probe (#764 follow-on).
 *
 * The cadence is an env default that an admin can override per-environment via
 * `CronJobScheduleOverride`. Readers must NOT use `pollMinutes()` to decide
 * staleness or bucket width — they read each sample's own `intervalMinutes`,
 * which records the cadence actually in force when the sample was written.
 */
import cron from "node-cron";

const DEFAULT_POLL_MINUTES = 15;
const DEFAULT_RETENTION_DAYS = 7;

/** Longest window `/api/ai-status/history` will serve, in hours. */
export const MAX_WINDOW_HOURS = 168;

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

export function pollMinutes(env: NodeJS.ProcessEnv = process.env): number {
  return positiveInt(env.AI_STATUS_POLL_MINUTES, DEFAULT_POLL_MINUTES);
}

/**
 * Retention is clamped up to at least the maximum query window. Otherwise a
 * short retention silently renders most of the chart grey, which reads as
 * downtime rather than as configuration.
 */
export function retentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const configured = positiveInt(env.AI_STATUS_SAMPLE_RETENTION_DAYS, DEFAULT_RETENTION_DAYS);
  return Math.max(configured, MAX_WINDOW_HOURS / 24);
}

/**
 * Build a node-cron expression for an every-N-minutes cadence. `*​/90` is not a
 * valid minute field, so anything that is neither sub-hour nor a whole number of
 * hours falls back to the default rather than leaving the job unscheduled.
 */
export function cronEvery(minutes: number): string {
  const fallback = `*/${DEFAULT_POLL_MINUTES} * * * *`;
  if (!Number.isSafeInteger(minutes) || minutes <= 0) return fallback;

  let expression: string;
  if (minutes < 60) {
    expression = `*/${minutes} * * * *`;
  } else if (minutes % 60 === 0 && minutes < 1440) {
    expression = `0 */${minutes / 60} * * *`;
  } else {
    console.warn(`[ai-status] AI_STATUS_POLL_MINUTES=${minutes} is not expressible; using 15`);
    return fallback;
  }

  if (!cron.validate(expression)) {
    console.warn(`[ai-status] generated invalid cron "${expression}"; using 15`);
    return fallback;
  }
  return expression;
}
