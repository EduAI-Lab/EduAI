import type { RbacUser } from "~/lib/auth/course-access.server";
import {
  CanvasNotConnectedError,
  InvalidCanvasCourseAccessError,
  listCanvasCoursesWithSyncState,
  validateInstructorCanvasCourseIds,
} from "~/lib/canvas/courses.server";
import {
  deleteCanvasIntegration,
  getCanvasIntegrationPublic,
  saveCanvasIntegration,
} from "~/lib/canvas/integration.server";
import { LinkRosterError, linkCanvasRoster } from "~/lib/canvas/link-roster.server";
import {
  ConnectCanvasSchema,
  LinkRosterSchema,
  SyncCanvasCoursesSchema,
} from "~/lib/canvas/schemas";
import { syncCanvasCourses } from "~/lib/canvas/sync.server";
import { resolveAdminUserId } from "./admin-context.server";

type ToolError = { error: string; fields?: Record<string, string> };

/** Resolve whose Canvas integration an admin tool operates on. */
export async function resolveCanvasSubjectUserId(
  actor: RbacUser,
  opts: { instructorUserId?: string; instructorEmail?: string },
): Promise<{ userId: string } | ToolError> {
  if (opts.instructorUserId?.trim() || opts.instructorEmail?.trim()) {
    const resolved = await resolveAdminUserId(actor, {
      userId: opts.instructorUserId,
      userEmail: opts.instructorEmail,
    });
    if ("error" in resolved) {
      return resolved;
    }
    return { userId: resolved.userId };
  }
  return { userId: actor.id };
}

export async function readCanvasIntegration(
  actor: RbacUser,
  opts: { instructorUserId?: string; instructorEmail?: string },
) {
  const subject = await resolveCanvasSubjectUserId(actor, opts);
  if ("error" in subject) {
    return subject;
  }
  const integration = await getCanvasIntegrationPublic(subject.userId);
  return {
    userId: subject.userId,
    integration,
    connected: integration != null,
  };
}

export async function readCanvasCourses(
  actor: RbacUser,
  opts: { instructorUserId?: string; instructorEmail?: string },
) {
  const subject = await resolveCanvasSubjectUserId(actor, opts);
  if ("error" in subject) {
    return subject;
  }
  try {
    const courses = await listCanvasCoursesWithSyncState(subject.userId);
    return { userId: subject.userId, courses };
  } catch (error) {
    return mapCanvasError(error);
  }
}

export async function connectCanvasForUser(
  actor: RbacUser,
  opts: {
    instructorUserId?: string;
    instructorEmail?: string;
    canvasUrl: string;
    apiKey?: string;
    isTestMode?: boolean;
  },
) {
  const subject = await resolveCanvasSubjectUserId(actor, opts);
  if ("error" in subject) {
    return subject;
  }

  const parsed = ConnectCanvasSchema.safeParse({
    canvasUrl: opts.canvasUrl,
    apiKey: opts.apiKey,
    isTestMode: opts.isTestMode,
  });
  if (!parsed.success) {
    return {
      error: "VALIDATION_ERROR",
      fields: Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [
          k,
          Array.isArray(v) ? v[0] : String(v),
        ]),
      ),
    } satisfies ToolError;
  }

  try {
    const integration = await saveCanvasIntegration(subject.userId, parsed.data);
    return { userId: subject.userId, integration };
  } catch (error) {
    return mapCanvasError(error);
  }
}

export async function syncCanvasForUser(
  actor: RbacUser,
  opts: {
    instructorUserId?: string;
    instructorEmail?: string;
    canvasCourseIds: string[];
  },
) {
  const subject = await resolveCanvasSubjectUserId(actor, opts);
  if ("error" in subject) {
    return subject;
  }

  const parsed = SyncCanvasCoursesSchema.safeParse({
    canvasCourseIds: opts.canvasCourseIds,
  });
  if (!parsed.success) {
    return {
      error: "VALIDATION_ERROR",
      fields: { canvasCourseIds: "invalid canvas course id list" },
    } satisfies ToolError;
  }

  try {
    await validateInstructorCanvasCourseIds(subject.userId, parsed.data.canvasCourseIds);
    const result = await syncCanvasCourses(subject.userId, parsed.data.canvasCourseIds);
    return { userId: subject.userId, sync: result };
  } catch (error) {
    return mapCanvasError(error);
  }
}

export async function disconnectCanvasForUser(
  actor: RbacUser,
  opts: { instructorUserId?: string; instructorEmail?: string },
) {
  const subject = await resolveCanvasSubjectUserId(actor, opts);
  if ("error" in subject) {
    return subject;
  }

  const existing = await getCanvasIntegrationPublic(subject.userId);
  await deleteCanvasIntegration(subject.userId);
  return {
    userId: subject.userId,
    disconnected: true,
    previousCanvasUrl: existing?.canvasUrl ?? null,
  };
}

export async function linkCanvasRosterForUser(
  actor: RbacUser,
  opts: { userId?: string; userEmail?: string; studentNumber: string },
) {
  const target = await resolveAdminUserId(actor, {
    userId: opts.userId,
    userEmail: opts.userEmail,
  });
  if ("error" in target) {
    return target;
  }

  const parsed = LinkRosterSchema.safeParse({ studentNumber: opts.studentNumber });
  if (!parsed.success) {
    return {
      error: "VALIDATION_ERROR",
      fields: { studentNumber: "invalid student number" },
    } satisfies ToolError;
  }

  try {
    const result = await linkCanvasRoster(target.userId, parsed.data.studentNumber);
    return { userId: target.userId, ...result };
  } catch (error) {
    if (error instanceof LinkRosterError) {
      return { error: error.message };
    }
    return mapCanvasError(error);
  }
}

function mapCanvasError(error: unknown): ToolError {
  if (error instanceof CanvasNotConnectedError) {
    return { error: "CANVAS_NOT_CONNECTED" };
  }
  if (error instanceof InvalidCanvasCourseAccessError) {
    return {
      error: "INVALID_CANVAS_COURSE_ACCESS",
      fields: { invalidCourseIds: error.invalidCourseIds.join(", ") },
    };
  }
  const message = error instanceof Error ? error.message : "CANVAS_REQUEST_FAILED";
  return { error: message };
}
