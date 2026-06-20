/**
 * @file Reads Core's configurable RBAC policy flags.
 *
 * Core owns the policy flags (an admin toggles them in Core's dashboard). This
 * service fetches `GET {EDUAI_BASE_URL}/policies` server-to-server with the
 * shared service key and caches the result on a short TTL so enforcement paths
 * don't hit Core on every request.
 *
 * On a fetch failure it serves the last known-good value, so a transient Core
 * blip never hard-fails the extension. But before the FIRST successful fetch
 * there is no known-good value, and we deliberately fail CLOSED rather than
 * serving permissive built-in defaults: an admin who disabled a flag in Core
 * must never be silently overridden because the extension cold-started during a
 * Core outage. `getPolicy` treats the unknown state as "deny".
 *
 * Mirrors the local-settings idiom in `systemSettings.js`, but sourced from Core.
 */

import { getEduAiBaseUrl } from './eduaiClient.js';
import { getEffectiveEduAiApiKey } from './systemSettings.js';

// Per-key default applied only when Core is REACHABLE but omits a key (e.g. an
// older Core that predates the flag). It is NOT an outage fallback: when Core is
// unreachable and there is no last-good value, `getPolicy` fails closed instead
// of consulting these. Keep in sync with Core's POLICY_FLAGS defaults.
const POLICY_DEFAULTS = Object.freeze({
  'instructors.canCreateCourses': true,
});

const TTL_MS = Number(process.env.POLICY_CACHE_TTL_MS) || 30_000;

let cache = null; // { value, expiresAt }
let lastGood = null; // last successfully fetched policy map

async function fetchPolicies() {
  const serviceKey = await getEffectiveEduAiApiKey();
  if (!serviceKey) {
    throw new Error('EDUAI_API_KEY not configured');
  }

  const response = await fetch(`${getEduAiBaseUrl()}/policies`, {
    headers: { Authorization: `Bearer ${serviceKey}` },
  });

  if (!response.ok) {
    const error = new Error(`Policy fetch failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const body = await response.json();
  return body?.policies ?? {};
}

/**
 * Resolve all policy flags from Core, cached. Returns the policy map on success
 * (or the last known-good map during a transient outage), or `null` when Core
 * has never been reached successfully — the caller must then fail closed.
 */
export async function getPolicies() {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.value;
  }

  try {
    const policies = await fetchPolicies();
    cache = { value: policies, expiresAt: Date.now() + TTL_MS };
    lastGood = policies;
    return policies;
  } catch (error) {
    // Serve the last known-good policy if we ever had one; otherwise return
    // null so enforcement fails CLOSED rather than serving permissive defaults.
    console.error('[policy] Failed to fetch policies from Core', error);
    return lastGood;
  }
}

/**
 * Resolve a single policy flag. When Core is reachable, an absent key falls back
 * to its built-in default. When the policy state is UNKNOWN (Core unreachable
 * and no last-good value), fails closed (returns false) so a disabled flag is
 * never silently treated as enabled.
 */
export async function getPolicy(key) {
  const policies = await getPolicies();
  if (!policies) {
    return false;
  }
  return policies[key] ?? POLICY_DEFAULTS[key] ?? false;
}

/** Drop the TTL cache so the next read re-fetches (last-good fallback is kept). */
export function invalidatePolicyCache() {
  cache = null;
}

/** Test seam: clear all in-memory state, including the last-good fallback. */
export function __resetPolicyServiceState() {
  cache = null;
  lastGood = null;
}
