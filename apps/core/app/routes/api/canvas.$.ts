import { auth } from "~/lib/auth/server";
import { ConnectCanvasSchema } from "~/lib/canvas/schemas";
import {
  canManageCanvasIntegration,
  deleteCanvasIntegration,
  getCanvasIntegrationPublic,
  saveCanvasIntegration,
} from "~/lib/canvas/integration.server";
import { CanvasVerificationError } from "~/lib/canvas/client.server";
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

  if (!canManageCanvasIntegration(session.user.role)) {
    return json({ success: false, error: "Forbidden: instructors only" }, 403);
  }

  const subpath = canvasSubpath(new URL(request.url).pathname);
  const userId = session.user.id;

  switch (request.method) {
    case "GET": {
      if (subpath !== "integration") {
        return json({ success: false, error: "Not found" }, 404);
      }

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

    case "POST": {
      if (subpath !== "connect") {
        return json({ success: false, error: "Not found" }, 404);
      }

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

      try {
        const integration = await saveCanvasIntegration(userId, result.data);
        return json({
          success: true,
          message: result.data.isTestMode
            ? "Canvas test mode enabled. You can test exports without a real Canvas account."
            : "Canvas integration connected successfully",
          data: integration,
        });
      } catch (error) {
        if (error instanceof CanvasVerificationError) {
          return json({ success: false, error: error.message }, error.statusCode);
        }
        const message = error instanceof Error ? error.message : "Failed to save Canvas integration";
        return json({ success: false, error: message }, 500);
      }
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
}
