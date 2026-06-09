import { auth } from "~/lib/auth/server";
import { CanvasApiError, CanvasVerificationError } from "~/lib/canvas/client.server";
import {
  CanvasNotConnectedError,
  listCanvasCoursesWithSyncState,
} from "~/lib/canvas/courses.server";
import {
  canManageCanvasIntegration,
  deleteCanvasIntegration,
  getCanvasIntegrationPublic,
  saveCanvasIntegration,
} from "~/lib/canvas/integration.server";
import {
  isCanvasLinkRosterRateLimited,
  LinkRosterError,
  linkCanvasRoster,
} from "~/lib/canvas/link-roster.server";
import { ConnectCanvasSchema, LinkRosterSchema, SyncCanvasCoursesSchema } from "~/lib/canvas/schemas";
import { syncCanvasCourses } from "~/lib/canvas/sync.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  return handleCanvasRequest(request);
}

export async function action({ request }: ActionFunctionArgs) {
  return handleCanvasRequest(request);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function canvasSubpath(pathname: string): string {
  return pathname.replace(/^\/api\/canvas\/?/, "");
}

async function handleCanvasRequest(request: Request): Promise<Response> {
  const session = await auth.api.getSession(request);
  if (!session?.user) {
    return json({ success: false, error: "Unauthorized" }, 401);
  }

  const subpath = canvasSubpath(new URL(request.url).pathname);
  const userId = session.user.id;

  if (subpath === "link-roster") {
    return handleLinkRosterRequest(request, userId);
  }

  if (!canManageCanvasIntegration(session.user.role)) {
    return json({ success: false, error: "Forbidden: instructors only" }, 403);
  }

  try {
    switch (request.method) {
      case "GET": {
        if (subpath === "integration") {
          const integration = await getCanvasIntegrationPublic(userId);
          if (!integration) {
            return json({
              success: true,
              data: null,
              message: "Canvas integration not configured",
            });
          }

          return json({ success: true, data: integration });
        }

        if (subpath === "courses") {
          const courses = await listCanvasCoursesWithSyncState(userId);
          return json({ success: true, data: { courses } });
        }

        return json({ success: false, error: "Not found" }, 404);
      }

      case "POST": {
        if (subpath === "connect") {
          let body: unknown;
          try {
            body = await request.json();
          } catch {
            return json({ success: false, error: "Invalid JSON body" }, 400);
          }

          const result = ConnectCanvasSchema.safeParse(body);
          if (!result.success) {
            return json(
              {
                success: false,
                error: "Invalid input",
                details: result.error.flatten(),
              },
              400,
            );
          }

          const integration = await saveCanvasIntegration(userId, result.data);
          return json({
            success: true,
            message: result.data.isTestMode
              ? "Canvas test mode enabled. You can test exports without a real Canvas account."
              : "Canvas integration connected successfully",
            data: integration,
          });
        }

        if (subpath === "sync") {
          let body: unknown;
          try {
            body = await request.json();
          } catch {
            return json({ success: false, error: "Invalid JSON body" }, 400);
          }

          const result = SyncCanvasCoursesSchema.safeParse(body);
          if (!result.success) {
            return json(
              {
                success: false,
                error: "Invalid input",
                details: result.error.flatten(),
              },
              400,
            );
          }

          const syncResult = await syncCanvasCourses(userId, result.data.canvasCourseIds);
          return json({ success: true, data: syncResult });
        }

        return json({ success: false, error: "Not found" }, 404);
      }

      case "DELETE": {
        if (subpath !== "disconnect") {
          return json({ success: false, error: "Not found" }, 404);
        }

        await deleteCanvasIntegration(userId);
        return json({
          success: true,
          message: "Canvas integration disconnected",
        });
      }

      default:
        return json({ success: false, error: "Method not allowed" }, 405);
    }
  } catch (error) {
    if (error instanceof CanvasNotConnectedError) {
      return json({ success: false, error: error.message }, 400);
    }
    if (error instanceof CanvasVerificationError) {
      return json({ success: false, error: error.message }, error.statusCode);
    }
    if (error instanceof CanvasApiError) {
      const status = error.statusCode === 401 ? 400 : error.statusCode >= 500 ? 502 : 400;
      return json({ success: false, error: error.message }, status);
    }
    if (process.env.NODE_ENV === "production") {
      console.error("Canvas API request failed:", error);
      return json({ success: false, error: "Canvas request failed" }, 500);
    }
    const message = error instanceof Error ? error.message : "Canvas request failed";
    return json({ success: false, error: message }, 500);
  }
}

async function handleLinkRosterRequest(request: Request, userId: string): Promise<Response> {
  if (request.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  if (isCanvasLinkRosterRateLimited(userId)) {
    return json(
      { success: false, error: "Too many link attempts. Please try again later." },
      429,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const result = LinkRosterSchema.safeParse(body);
  if (!result.success) {
    return json(
      {
        success: false,
        error: "Invalid input",
        details: result.error.flatten(),
      },
      400,
    );
  }

  try {
    const linkResult = await linkCanvasRoster(userId, result.data.studentNumber);
    return json({
      success: true,
      message: "Canvas enrollments linked successfully",
      data: linkResult,
    });
  } catch (error) {
    if (error instanceof LinkRosterError) {
      return json({ success: false, error: error.message }, error.statusCode);
    }
    if (process.env.NODE_ENV === "production") {
      console.error("Canvas link-roster failed:", error);
      return json({ success: false, error: "Failed to link Canvas enrollments" }, 500);
    }
    const message = error instanceof Error ? error.message : "Failed to link Canvas enrollments";
    return json({ success: false, error: message }, 500);
  }
}
