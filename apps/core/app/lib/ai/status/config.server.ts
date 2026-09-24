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
 * Read an every-N-minutes cadence back out of a cron expression — the inverse
 * of `cronEvery`, plus the two fixed-time shapes an admin can type by hand.
 *
 * The probe stamps each sample with the cadence in force so the reader never
 * has to consult env, but the cadence in force is whatever
 * `CronJobScheduleOverride` says, not what env says. Returns null for anything
 * it cannot read as a simple fixed period (e.g. `0 9,17 * * 1-5`), so the
 * caller falls back to the env default rather than inventing a number.
 */
export function minutesFromCron(expression: string | null | undefined): number | null {
  const raw = (expression ?? "").trim();
  if (raw === "") return null;
  const fields = raw.split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  // A cadence restricted to particular days is not a fixed period at all.
  if (dayOfMonth !== "*" || month !== "*" || dayOfWeek !== "*") return null;

  const everyMinutes = /^\*\/(\d{1,4})$/.exec(minute);
  if (everyMinutes && hour === "*") {
    const n = Number(everyMinutes[1]);
    return Number.isSafeInteger(n) && n > 0 && n < 60 ? n : null;
  }

  const isFixedMinute = /^\d{1,2}$/.test(minute) && Number(minute) < 60;
  if (!isFixedMinute) return null;
  if (hour === "*") return 60;

  const everyHours = /^\*\/(\d{1,2})$/.exec(hour);
  if (everyHours) {
    const n = Number(everyHours[1]);
    return Number.isSafeInteger(n) && n > 0 && n < 24 ? n * 60 : null;
  }
  if (/^\d{1,2}$/.test(hour) && Number(hour) < 24) return 1440;
  return null;
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
