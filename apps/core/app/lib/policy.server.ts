import prisma from "~/lib/prisma.server";
import { fireAndForget, logSecurityEvent } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

/**
 * @file Configurable RBAC policy flags.
 *
 * A small, central registry of runtime-toggleable permission flags. Each flag
 * has a code default; an admin can override it, and the override is persisted in
 * the `SystemConfig` key/value table under the `policy.` key prefix. The former
 * standalone `webToolsEnabled` `SystemConfig` row was folded into this registry
 * as `chat.webToolsEnabled` (see the key carry-over migration).
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
  "instructors.canPublishCourses": {
    label: "Instructors can publish courses",
    description:
      "Allow users with the INSTRUCTOR role to publish/unpublish their courses. ADMIN and UNIT_ADMIN are unaffected.",
    default: true,
  },
  "instructors.canManageEnrollments": {
    label: "Instructors can manage enrollments",
    description:
      "Allow users with the INSTRUCTOR role to add/remove students and TAs in their courses. ADMIN and UNIT_ADMIN are unaffected.",
    default: true,
  },
  "instructors.canManageCanvasIntegration": {
    label: "Instructors can manage Canvas integration",
    description:
      "Allow users with the INSTRUCTOR role to connect and sync Canvas. ADMIN is unaffected.",
    default: true,
  },
  "instructors.canDeleteCourses": {
    label: "Instructors can delete courses",
    description:
      "Allow users with the INSTRUCTOR role to soft-delete their courses. ADMIN and UNIT_ADMIN are unaffected.",
    default: true,
  },
  "tas.canManageMaterials": {
    label: "TAs can manage course materials",
    description:
      "Allow users with the TA role to upload and delete course materials. Instructors, unit admins, and admins are unaffected.",
    default: true,
  },
  "students.canUploadMaterials": {
    label: "Students can upload course materials",
    description:
      "Allow users with the STUDENT role to upload course materials in courses they are enrolled in.",
    default: false,
  },
  "chat.webToolsEnabled": {
    label: "Web search tools enabled",
    description:
      "Global on/off for web search and fetch tools in chat. When off, web tools are never registered for anyone.",
    default: false,
  },
  "unitAdmins.canDeleteCourses": {
    label: "Unit admins can delete courses",
    description:
      "Allow users with the UNIT_ADMIN role to soft-delete courses in their units. ADMIN is always allowed.",
    default: true,
  },
  "students.canViewMaterials": {
    label: "Students can view course materials",
    description:
      "Allow students to view/list course materials. Layers on top of the publish gate; off means students cannot list materials at all.",
    default: true,
  },
  "tas.canSetAiInstructions": {
    label: "TAs can edit AI instructions",
    description:
      "Allow users with the TA role to edit a course's AI instructions field only (no other course fields).",
    default: false,
  },
  "tas.canManageTopics": {
    label: "TAs can manage course topics",
    description:
      "Allow users with the TA role to create, edit, and delete any topic in their courses (supersedes the own-only carve-out).",
    default: false,
  },
  "instructors.canViewCourseChats": {
    label: "Instructors can view course chats",
    description:
      "Allow users with the INSTRUCTOR role to read student chats in their courses.",
    default: false,
  },
  "unitAdmins.canViewUnitChats": {
    label: "Unit admins can view unit chats",
    description:
      "Allow users with the UNIT_ADMIN role to read student chats across courses in their units.",
    default: false,
  },
  "unitAdmins.canInvite": {
    label: "Unit admins can invite users",
    description:
      "Allow users with the UNIT_ADMIN role to invite instructors and students to the platform. ADMIN is always allowed.",
    default: false,
  },
  "auth.allowPublicRegistration": {
    label: "Allow public registration",
    description:
      "Allow public email/password self-signup (new users default to STUDENT). Off blocks the signup endpoint and hides the signup UI; invitation-based account creation is unaffected.",
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
