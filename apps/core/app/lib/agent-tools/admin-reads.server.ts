import type { RbacUser } from "~/lib/auth/course-access.server";
import { readCanvasCourses, readCanvasIntegration } from "./admin-canvas.server";
import { listAdminInvitations as listInvitationsForAdmin } from "./admin-invitations.server";

type ToolError = { error: string; fields?: Record<string, string> };

function requirePlatformAdmin(user: RbacUser): ToolError | null {
  if (user.role !== "ADMIN") {
    return { error: "Forbidden" };
  }
  return null;
}

function adminToolPayload<T extends Record<string, unknown>>(data: T) {
  return {
    dataSource: "database" as const,
    queriedAt: new Date().toISOString(),
    ...data,
  };
}

/** ADMIN-only invitation list (read-only). */
export async function listAdminInvitations(user: RbacUser, limit = 200) {
  const denied = requirePlatformAdmin(user);
  if (denied) return denied;

  const result = await listInvitationsForAdmin(user, limit);
  if ("error" in result) {
    return result;
  }

  return adminToolPayload({
    invitations: result.invitations,
    count: result.count,
    total: result.total,
    truncated: result.truncated,
  });
}

/** ADMIN — Canvas integration status for self or an instructor. */
export async function getAdminCanvasIntegration(
  user: RbacUser,
  opts: { instructorUserId?: string; instructorEmail?: string } = {},
) {
  const denied = requirePlatformAdmin(user);
  if (denied) return denied;

  const result = await readCanvasIntegration(user, opts);
  if ("error" in result) {
    return result;
  }

  return adminToolPayload(result);
}

/** ADMIN — list Canvas courses with sync state for self or an instructor. */
export async function listAdminCanvasCourses(
  user: RbacUser,
  opts: { instructorUserId?: string; instructorEmail?: string } = {},
) {
  const denied = requirePlatformAdmin(user);
  if (denied) return denied;

  const result = await readCanvasCourses(user, opts);
  if ("error" in result) {
    return result;
  }

  return adminToolPayload({
    userId: result.userId,
    courses: result.courses,
    count: result.courses.length,
  });
}
