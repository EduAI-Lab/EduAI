import prisma from "~/lib/prisma.server";

/**
 * @file Configurable RBAC policy flags.
 *
 * A small, central registry of runtime-toggleable permission flags. Each flag
 * has a code default; an admin can override it, and the override is persisted in
 * the `SystemConfig` key/value table under the `policy.` key prefix (mirroring
 * the single-flag pattern in `system-config.server.ts`).
 *
 * Reads are served through a short-TTL in-memory cache so the hot enforcement
 * paths (e.g. course creation) don't hit the DB on every request; `setPolicy`
 * clears the cache for in-process immediacy, and the TTL bounds staleness across
 * multiple server instances.
 *
 * This is the single source of truth consumed by Core itself (in-process via
 * `getPolicy`) and by the extension apps (over HTTP via `GET /api/policies`).
 * Adding a new flag is a single entry in `POLICY_FLAGS`.
 */

const KEY_PREFIX = "policy.";

const CACHE_TTL_MS = 10 * 1000;

/**
 * Registry of policy flags. To add a flag: add one entry here, then read it with
 * `getPolicy(...)` at the enforcement site — the admin UI renders this registry.
 */
export const POLICY_FLAGS = {
  "instructors.canCreateCourses": {
    label: "Instructors can create courses",
    description:
      "Allow users with the INSTRUCTOR role to create courses. Applies to Core and AI Tutor.",
    default: true,
  },
} as const;

export type PolicyKey = keyof typeof POLICY_FLAGS;
export type PolicyMap = Record<PolicyKey, boolean>;

const POLICY_KEYS = Object.keys(POLICY_FLAGS) as PolicyKey[];

export function isPolicyKey(key: string): key is PolicyKey {
  return Object.prototype.hasOwnProperty.call(POLICY_FLAGS, key);
}

/** Metadata (label/description/default) for rendering the admin toggles. */
export function getPolicyDefinitions() {
  return POLICY_KEYS.map((key) => ({
    key,
    label: POLICY_FLAGS[key].label,
    description: POLICY_FLAGS[key].description,
    default: POLICY_FLAGS[key].default,
  }));
}

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
