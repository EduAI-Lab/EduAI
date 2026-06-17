/**
 * @file Reads Core's configurable RBAC policy flags.
 *
 * Core owns the policy flags (an admin toggles them in Core's dashboard). This
 * service fetches `GET {EDUAI_BASE_URL}/policies` server-to-server with the
 * shared service key and caches the result on a short TTL so enforcement paths
 * don't hit Core on every request. On a fetch failure it serves the last good
 * value (falling back to built-in defaults), so a Core blip never hard-fails the
 * extension — it just keeps the most recent known policy.
 *
 * Mirrors the local-settings idiom in `systemSettings.js`, but sourced from Core.
 */

import { getEduAiBaseUrl } from './eduaiClient.js';
import { getEffectiveEduAiApiKey } from './systemSettings.js';

// Safe baseline used before the first successful fetch and as the ultimate
// fallback. Keep in sync with Core's POLICY_FLAGS defaults.
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

/** Resolve all policy flags (defaults overlaid with Core's values), cached. */
export async function getPolicies() {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.value;
  }

  try {
    const policies = { ...POLICY_DEFAULTS, ...(await fetchPolicies()) };
    cache = { value: policies, expiresAt: Date.now() + TTL_MS };
    lastGood = policies;
    return policies;
  } catch (error) {
    // Serve the last known-good policy, or defaults — never hard-fail.
    console.error('[policy] Failed to fetch policies from Core', error);
    return lastGood ?? { ...POLICY_DEFAULTS };
  }
}

/** Resolve a single policy flag, falling back to its built-in default. */
export async function getPolicy(key) {
  const policies = await getPolicies();
  return policies[key] ?? POLICY_DEFAULTS[key];
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
