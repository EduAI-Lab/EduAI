import prisma from "~/lib/prisma.server";
import { fireAndForget, logSecurityEvent } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import {
  POLICY_FLAGS,
  POLICY_KEYS,
  isPolicyKey,
  type PolicyKey,
  type PolicyMap,
} from "~/lib/policy-flags";

/**
 * @file Configurable RBAC policy flags (server side).
 *
 * The flag registry itself (keys, defaults, metadata, `PolicyKey` type) lives in
 * the client-safe `~/lib/policy-flags` module and is re-exported below, so both
 * server enforcement and client UI can mirror the same source of truth. This file
 * adds the persistence + caching layer.
 *
 * Each flag has a code default; an admin can override it, and the override is
 * persisted in the `SystemConfig` key/value table under the `policy.` key prefix.
 * The former standalone `webToolsEnabled` `SystemConfig` row was folded into this
 * registry as `chat.webToolsEnabled` (see the key carry-over migration).
 *
 * Reads are served through a short-TTL in-memory cache so the hot enforcement
 * paths (e.g. course creation) don't hit the DB on every request; `setPolicy`
 * clears the cache for in-process immediacy, and the TTL bounds staleness across
 * multiple server instances.
 *
 * This is the single source of truth consumed by Core itself (in-process via
 * `getPolicy`) and by the extension apps (over HTTP via `GET /api/policies`).
 */

// Re-export the registry surface so existing `~/lib/policy.server` importers
// (and the admin UI) keep working unchanged.
export {
  POLICY_FLAGS,
  POLICY_KEYS,
  isPolicyKey,
  getPolicyDefinitions,
} from "~/lib/policy-flags";
export type { PolicyKey, PolicyMap } from "~/lib/policy-flags";

const KEY_PREFIX = "policy.";

const CACHE_TTL_MS = 10 * 1000;

let cache: { value: PolicyMap; expiresAt: number } | null = null;

export function invalidatePolicyCache(): void {
  cache = null;
}

function buildDefaults(): PolicyMap {
  const out = {} as PolicyMap;
  for (const key of POLICY_KEYS) out[key] = POLICY_FLAGS[key].default;
  return out;
}

/**
 * Resolve all policy flags: code defaults overlaid with any persisted overrides.
 * Unknown/legacy `SystemConfig` rows are ignored; absent rows keep the default.
 */
export async function getPolicies(): Promise<PolicyMap> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.value;
  }

  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: POLICY_KEYS.map((key) => KEY_PREFIX + key) } },
    select: { key: true, value: true },
  });

  const value = buildDefaults();
  for (const row of rows) {
    const flag = row.key.slice(KEY_PREFIX.length);
    if (isPolicyKey(flag)) value[flag] = row.value === "true";
  }

  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

/** Resolve a single policy flag. */
export async function getPolicy(key: PolicyKey): Promise<boolean> {
  const policies = await getPolicies();
  return policies[key];
}

/** Persist an override for a flag and invalidate the cache (live effect). */
export async function setPolicy(
  key: PolicyKey,
  value: boolean,
  updatedBy: string,
): Promise<void> {
  await prisma.systemConfig.upsert({
    where: { key: KEY_PREFIX + key },
    create: {
      key: KEY_PREFIX + key,
      value: String(value),
      description: POLICY_FLAGS[key].description,
      updatedBy,
    },
    update: {
      value: String(value),
      updatedBy,
    },
  });
  invalidatePolicyCache();
}

const FORBIDDEN_BODY = JSON.stringify({ error: "Forbidden" });

/** The canonical 403 body returned for every policy-gated denial. */
export function policyForbidden(): Response {
  return new Response(FORBIDDEN_BODY, {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

export type PolicyDenialInput = {
  policyKey: PolicyKey;
  // The denied actor (a better-auth session `user` satisfies this), or null for
  // anonymous denials (e.g. the public-registration chokepoint).
  user: { id: string; role?: string | null } | null;
  action: string; // e.g. "course.publish"
  courseId?: string;
  // Optional: when provided, the audit line carries full request metadata
  // (request id, route, method, ip, user-agent).
  request?: Request;
};

/**
 * Record a policy-flag-caused 403 as a SECURITY audit event through the shared
 * logging facade (`logging.server.ts` → Postgres `audit_logs`, auto-redacted,
 * surfaced at `/admin/logs`). Fire-and-forget so enforcement paths never pay
 * log-write latency. This is the single source of truth for denial logging.
 */
export function logPolicyDenial(input: PolicyDenialInput): void {
  fireAndForget(
    logSecurityEvent({
      ...getActorContext(input.user),
      ...(input.request ? getRequestContext(input.request) : {}),
      actionCode: "POLICY_DENIED",
      outcome: "DENIED",
      entityType: input.courseId ? "Course" : "Policy",
      entityId: input.courseId ?? null,
      details: { policyKey: input.policyKey, action: input.action },
    }),
  );
}

/**
 * Unified policy gate: log the denial AND return the standard 403 in one call.
 * Every policy-flag enforcement site funnels through this so the audit trail and
 * the response body stay consistent.
 */
export function denyByPolicy(input: PolicyDenialInput): Response {
  logPolicyDenial(input);
  return policyForbidden();
}
