/**
 * Reading the numbers out of an AI variant review.
 *
 * Every score in the review is produced by a model, so a field can come back
 * absent, null, or not a finite number even when the rubric asked for one. The
 * review type spells that as `number | null`, and these helpers are how callers
 * act on it: ask whether there is a usable measurement, then render or compute
 * with it. The page and the .docx exporter both read the same review, and both
 * used to re-derive this per field.
 */

/** A single review score, as the model may or may not have produced it. */
export type ReviewMetric = number | null | undefined;

/**
 * The metric as a usable number, or null.
 *
 * `NaN` and `Infinity` are rejected alongside an absent value: a score that
 * cannot be compared or formatted is not a measurement, and letting one through
 * turns a report into `NaN` several lines later.
 */
export function finiteMetric(value: ReviewMetric): number | null {
  if (value === null || value === undefined) return null;
  return Number.isFinite(value) ? value : null;
}

/** The metric rounded for display, or `n/a` where there is none. */
export function formatMetric(value: ReviewMetric, fractionDigits: number): string {
  const usable = finiteMetric(value);
  return usable === null ? "n/a" : usable.toFixed(fractionDigits);
}

/** A millisecond measurement as seconds, preserving an absent one. */
export function metricAsSeconds(value: ReviewMetric): number | null {
  const usable = finiteMetric(value);
  return usable === null ? null : usable / 1000;
}
