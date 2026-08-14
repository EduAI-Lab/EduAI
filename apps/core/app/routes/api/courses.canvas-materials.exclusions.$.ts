import type { ActionFunctionArgs } from "react-router";
import {
  resolveCourseAccessGate,
  type AccessLevel,
  type RbacUser,
} from "~/lib/auth/course-access.server";
import {
  CanvasMaterialSyncError,
  excludeCanvasMaterial,
  unexcludeCanvasMaterial,
} from "~/lib/canvas/materials.server";
import { ExcludeCanvasMaterialSchema } from "~/lib/canvas/schemas";
import type { Session } from "~/lib/auth/server";
import { getRequestSession } from "~/lib/auth/request-session.server";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function resolveInstructorAccess(
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

export async function action({ request, params }: ActionFunctionArgs) {
  const courseId = params.courseId;
  if (!courseId) {
    return json(400, { success: false, error: "Course ID is required" });
  }

  if (request.method !== "POST" && request.method !== "DELETE") {
    return json(405, { success: false, error: "Method not allowed" });
  }

  const resolved = await resolveInstructorAccess(request, courseId);
  if (resolved.response) return resolved.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { success: false, error: "Invalid JSON body" });
  }

  const parsed = ExcludeCanvasMaterialSchema.safeParse(body);
  if (!parsed.success) {
    return json(400, { success: false, error: "Invalid input", details: parsed.error.flatten() });
  }

  try {
    if (request.method === "POST") {
      await excludeCanvasMaterial(resolved.user.id, courseId, parsed.data.canvasFileId);
      return json(200, { success: true });
    }

    await unexcludeCanvasMaterial(resolved.user.id, courseId, parsed.data.canvasFileId);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof CanvasMaterialSyncError) {
      return json(error.statusCode, { success: false, error: error.message });
    }
    if (process.env.NODE_ENV === "production") {
      console.error("Canvas material exclusion failed:", error);
      return json(500, { success: false, error: "Canvas material exclusion failed" });
    }
    const message = error instanceof Error ? error.message : "Canvas material exclusion failed";
    return json(500, { success: false, error: message });
  }
}
