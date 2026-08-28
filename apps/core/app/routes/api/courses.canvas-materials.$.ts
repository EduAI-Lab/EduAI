import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  resolveCourseAccessGate,
  type AccessLevel,
  type RbacUser,
} from "~/lib/auth/course-access.server";
import { CanvasApiError, CanvasVerificationError } from "~/lib/canvas/client.server";
import {
  CanvasNotConnectedError,
  InvalidCanvasCourseAccessError,
} from "~/lib/canvas/courses.server";
import { CanvasStoredCredentialsError } from "~/lib/canvas/integration.server";
import {
  CanvasMaterialSyncError,
  discoverCanvasMaterialsForCourse,
  syncSelectedCanvasMaterials,
} from "~/lib/canvas/materials.server";
import { SyncCanvasMaterialsSchema } from "~/lib/canvas/schemas";
import type { Session } from "~/lib/auth/server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import type { JsonResponseBody } from "~/lib/api/json-response.server";

function json(status: number, body: JsonResponseBody) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function resolveInstructorCanvasMaterialsAccess(
  request: Request,
  courseId: string,
): Promise<
  | { response: Response; user?: never }
  | { response?: never; user: Session["user"]; access: AccessLevel }
> {
  const session = await getRequestSession(request);
  if (!session?.user) {
    return { response: json(401, { success: false, error: "Unauthorized" }) };
  }

  const rbacUser: RbacUser = {
    id: session.user.id,
    role: session.user.role,
    authorizedUnits: session.user.authorizedUnits ?? undefined,
  };

  const { course, access } = await resolveCourseAccessGate(rbacUser, courseId);
  if (!course) {
    return { response: json(404, { success: false, error: "Course not found" }) };
  }
  if (!access || access.level !== "instructor") {
    return { response: json(403, { success: false, error: "Forbidden: instructors only" }) };
  }

  return { user: session.user, access };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const courseId = params.courseId;
  if (!courseId) {
    return json(400, { success: false, error: "Course ID is required" });
  }

  const resolved = await resolveInstructorCanvasMaterialsAccess(request, courseId);
  if (resolved.response) return resolved.response;

  try {
    const recheckPublishState = new URL(request.url).searchParams.get("recheck") === "true";
    const files = await discoverCanvasMaterialsForCourse(resolved.user.id, courseId, undefined, {
      recheckPublishState,
    });
    return json(200, { success: true, data: { files } });
  } catch (error) {
    return mapCanvasMaterialsError(error);
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const courseId = params.courseId;
  if (!courseId) {
    return json(400, { success: false, error: "Course ID is required" });
  }

  if (request.method !== "POST") {
    return json(405, { success: false, error: "Method not allowed" });
  }

  const resolved = await resolveInstructorCanvasMaterialsAccess(request, courseId);
  if (resolved.response) return resolved.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { success: false, error: "Invalid JSON body" });
  }

  const parsed = SyncCanvasMaterialsSchema.safeParse(body);
  if (!parsed.success) {
    return json(400, {
      success: false,
      error: "Invalid input",
      details: parsed.error.flatten(),
    });
  }

  try {
    const data = await syncSelectedCanvasMaterials(
      resolved.user.id,
      courseId,
      parsed.data.canvasFileIds,
    );
    return json(200, { success: true, data });
  } catch (error) {
    return mapCanvasMaterialsError(error);
  }
}

function mapCanvasMaterialsError(cause: unknown): Response {
  if (cause instanceof CanvasMaterialSyncError) {
    return json(cause.statusCode, { success: false, error: cause.message });
  }
  if (cause instanceof CanvasNotConnectedError) {
    return json(400, { success: false, error: cause.message });
  }
  if (cause instanceof CanvasStoredCredentialsError) {
    return json(400, { success: false, error: cause.message });
  }
  if (cause instanceof InvalidCanvasCourseAccessError) {
    return json(403, {
      success: false,
      error: cause.message,
      invalidCourseIds: cause.invalidCourseIds,
    });
  }
  if (cause instanceof CanvasVerificationError) {
    return json(cause.statusCode, { success: false, error: cause.message });
  }
  if (cause instanceof CanvasApiError) {
    const status = cause.statusCode === 401 ? 400 : cause.statusCode >= 500 ? 502 : 400;
    return json(status, { success: false, error: cause.message });
  }
  if (process.env.NODE_ENV === "production") {
    console.error("Canvas material sync failed:", cause);
    return json(500, { success: false, error: "Canvas material sync failed" });
  }
  const message = cause instanceof Error ? cause.message : "Canvas material sync failed";
  return json(500, { success: false, error: message });
}
