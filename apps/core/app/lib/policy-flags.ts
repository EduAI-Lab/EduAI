/**
 * @file Configurable RBAC policy flag registry — pure data, no server deps.
 *
 * Split out from `policy.server.ts` so the client can import the flag keys,
 * defaults, and types (e.g. to mirror backend enforcement in the UI by greying
 * out controls an admin has turned off). `policy.server.ts` re-exports
 * everything here, so server-side importers are unaffected.
 *
 * Adding a new flag is still a single entry in `POLICY_FLAGS`.
 */

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
      "Allow users with the TA role to upload course materials, and delete materials they uploaded themselves. Instructors, unit admins, and admins are unaffected.",
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

export const POLICY_KEYS = Object.keys(POLICY_FLAGS) as PolicyKey[];

export function isPolicyKey(key: string): key is PolicyKey {
  return Object.prototype.hasOwnProperty.call(POLICY_FLAGS, key);
}

/** Code default for a flag — the value used until an admin overrides it. */
export function policyDefault(key: PolicyKey): boolean {
  return POLICY_FLAGS[key].default;
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
