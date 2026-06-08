import type { ActionFunctionArgs } from "react-router";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { createBugReport } from "~/lib/bug-reports/server";

export async function action({ request }: ActionFunctionArgs) {
  const guard = await requireServiceKey(request);
  if (guard) return guard;

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "VALIDATION_ERROR", fields: { body: "invalid JSON" } }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await createBugReport(body);

  if (!result.ok) {
    if (result.error === "VALIDATION_ERROR") {
      return new Response(
        JSON.stringify({ error: "VALIDATION_ERROR", fields: result.fields }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ error: result.error }),
      { status: 422, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(null, { status: 201 });
}
