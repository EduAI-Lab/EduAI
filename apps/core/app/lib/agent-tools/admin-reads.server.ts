import type { RbacUser } from "~/lib/auth/course-access.server";
import { readCanvasCourses, readCanvasIntegration } from "./admin-canvas.server";
import { listAdminInvitations as listInvitationsForAdmin } from "./admin-invitations.server";
import {
  getAdminCourseEmbeddingSettings,
  getAdminCourseRagSettings,
  getAdminCourseReEmbedJob,
  getAdminCronJobRuns,
  getAdminDashboardStats,
  getAdminPolicies,
  listAdminAiProviders,
  listAdminCanvasMaterials,
  listAdminCourseChats,
  listAdminCourseMaterials,
  listAdminCourseTAs,
  listAdminCronJobs,
  listAdminUnitChats,
} from "./admin-platform.server";

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

export async function readAdminCourseRagSettings(
  user: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
) {
  return getAdminCourseRagSettings(user, opts);
}

export async function readAdminCourseMaterials(
  user: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
) {
  return listAdminCourseMaterials(user, opts);
}

export async function readAdminCourseEmbeddingSettings(
  user: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
) {
  return getAdminCourseEmbeddingSettings(user, opts);
}

export async function readAdminCourseReEmbedJob(
  user: RbacUser,
  opts: {
    courseId?: string;
    courseCode?: string;
    fallbackCourseId?: string | null;
    jobId: string;
  },
) {
  return getAdminCourseReEmbedJob(user, opts);
}

export async function readAdminCanvasMaterials(
  user: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
) {
  return listAdminCanvasMaterials(user, opts);
}

export async function readAdminCourseTAs(
  user: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null },
) {
  return listAdminCourseTAs(user, opts);
}

export async function readAdminCourseChats(
  user: RbacUser,
  opts: { courseId?: string; courseCode?: string; fallbackCourseId?: string | null; limit?: number },
) {
  return listAdminCourseChats(user, opts);
}

export async function readAdminUnitChats(user: RbacUser, department: string, limit?: number) {
  return listAdminUnitChats(user, department, limit);
}

export async function readAdminPolicies(user: RbacUser) {
  return getAdminPolicies(user);
}

export async function readAdminAiProviders(user: RbacUser) {
  return listAdminAiProviders(user);
}

export async function readAdminCronJobs(user: RbacUser) {
  return listAdminCronJobs(user);
}

export async function readAdminCronJobRuns(user: RbacUser, jobName: string) {
  return getAdminCronJobRuns(user, jobName);
}

export async function readAdminDashboardStats(user: RbacUser) {
  return getAdminDashboardStats(user);
}
