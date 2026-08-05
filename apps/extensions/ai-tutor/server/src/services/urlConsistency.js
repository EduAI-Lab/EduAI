/**
 * @file Startup consistency check for AI Tutor's two independently-configured
 * Core base URLs (#225 edge-case audit SEAM-05).
 *
 * `CORE_URL` (`middleware/auth.js` — session validation) and
 * `EDUAI_BASE_URL` (`services/eduaiClient.js` — course catalog, completion,
 * publish state) are set separately in env config. If they resolve to
 * different origins, session auth and catalog/completion silently target
 * different Core backends: a request could authenticate against one Core
 * deployment and read/write course data against another.
 *
 * `assertCoreUrlConsistency` compares only the *origin* (protocol + host +
 * port) — not the full URL — since `EDUAI_BASE_URL` legitimately carries an
 * `/api` path segment that `CORE_URL` does not.
 */

let hasWarned = false;

function originOf(rawUrl) {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).origin;
  } catch {
    // Malformed URL — not this helper's job to validate shape; callers that
    // actually fetch will surface that failure on their own.
    return null;
  }
}

/**
 * Compares `CORE_URL` and `EDUAI_BASE_URL`'s origins.
 *
 * Returns `{ consistent, coreOrigin, eduaiOrigin }`. When either var is
 * unset or unparsable there is nothing to compare, so it reports
 * `consistent: true` (no signal is not a mismatch).
 *
 * Side effects: warns once (module-lifetime) on a mismatch; when
 * `EDUAI_ENFORCE_URL_CONSISTENCY=1` is set, throws instead so a pilot
 * deployment can turn this into a hard startup failure rather than a
 * runtime landmine.
 *
 * @param {Record<string, string | undefined>} [env] injectable for tests; defaults to `process.env`.
 */
export function assertCoreUrlConsistency(env = process.env) {
  const coreOrigin = originOf(env.CORE_URL);
  const eduaiOrigin = originOf(env.EDUAI_BASE_URL);
  const consistent = !coreOrigin || !eduaiOrigin || coreOrigin === eduaiOrigin;

  if (!consistent) {
    const message =
      `[config] CORE_URL origin (${coreOrigin}) and EDUAI_BASE_URL origin (${eduaiOrigin}) ` +
      'differ. Session auth (CORE_URL) and course catalog/completion (EDUAI_BASE_URL) will ' +
      'target different Core backends. Point them at the same origin, or set ' +
      'EDUAI_ENFORCE_URL_CONSISTENCY=1 to fail startup on this mismatch instead of only warning.';

    if (env.EDUAI_ENFORCE_URL_CONSISTENCY === '1') {
      throw new Error(message);
    }
    if (!hasWarned) {
      console.warn(message);
      hasWarned = true;
    }
  }

  return { consistent, coreOrigin, eduaiOrigin };
}

/** Test-only: resets the warn-once latch between test cases. */
export function __resetCoreUrlConsistencyWarningForTests() {
  hasWarned = false;
}
