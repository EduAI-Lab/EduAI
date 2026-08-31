import type { ActionFunctionArgs } from "react-router";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { notifyExpiringApiKeys } from "~/lib/cron-notify-api-key-expiry.server";
import { withErrorResponse } from "~/lib/errors.server";

export async function action({ request }: ActionFunctionArgs) {
  return withErrorResponse(
    async () => {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json" },
        });
      }

      const authError = await requireServiceKey(request);
      if (authError) return authError;

      const result = await notifyExpiringApiKeys();

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    { request },
  );
}
