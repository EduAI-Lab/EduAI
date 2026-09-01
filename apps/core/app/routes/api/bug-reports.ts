import type { JsonObject, JsonValue } from "~/lib/json-value";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { createBugReport, listOwnBugReports } from "~/lib/bug-reports/server";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { asJsonObject } from "~/lib/json-value";
import { withErrorResponse } from "~/lib/errors.server";

/**
 * GET /api/bug-reports?mine=true (#304, §11) — own submitted reports for any
 * authenticated user (own-resource fallback, §19).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  return withErrorResponse(
    async () => {
      const url = new URL(request.url);
      if (url.searchParams.get("mine") !== "true") {
        // The cross-user listing lives at /api/admin/bug-reports (ADMIN-only).
        return new Response(JSON.stringify({ error: "MINE_PARAM_REQUIRED" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const session = await getRequestSession(request);
      if (!session?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const reports = await listOwnBugReports(session.user.id);
      return new Response(JSON.stringify({ reports }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    { request },
  );
}

export async function action({ request }: ActionFunctionArgs) {
  return withErrorResponse(
    async () => {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Accept service-to-service (Bearer) and browser session auth for CORE.
      // Extension sources (AI_TUTOR, QUESTION_MAKER) always require a service key.
      const authHeader = request.headers.get("Authorization");

      let body: JsonValue;
      try {
        // SAFETY: `Response#json` resolves to whatever the client sent; naming it
        // `JsonValue` claims only what JSON parsing already guarantees.
        body = (await request.json()) as JsonValue;
      } catch {
        return new Response(
          JSON.stringify({ error: "VALIDATION_ERROR", fields: { body: "invalid JSON" } }),
          {
            status: 422,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const source = asJsonObject(body)?.source;
      const extensionSource = source === "AI_TUTOR" || source === "QUESTION_MAKER";
      let sessionUserId: string | null = null;

      if (extensionSource || authHeader?.startsWith("Bearer ")) {
        const guard = await requireServiceKey(request);
        if (guard) return guard;
      } else {
        const session = await getRequestSession(request);
        if (!session?.user) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        sessionUserId = session.user.id;
      }

      // For session-auth requests, override userId and source from the verified session.
      if (sessionUserId) {
        const fields: JsonObject = { ...asJsonObject(body) };
        fields.userId = sessionUserId;
        fields.source = "CORE";
        body = fields;
      }

      const result = await createBugReport(body);

      if (!result.ok) {
        if (result.error === "VALIDATION_ERROR") {
          return new Response(
            JSON.stringify({ error: "VALIDATION_ERROR", fields: result.fields }),
            {
              status: 422,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(JSON.stringify({ error: result.error }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ id: result.report.id }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    },
    { request },
  );
}
