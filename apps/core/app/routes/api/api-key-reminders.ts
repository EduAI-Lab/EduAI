import type { ActionFunctionArgs } from "react-router";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { sendApiKeyExpirationReminders } from "~/lib/api-keys/reminders.server";

/**
 * POST /api/api-key-reminders
 *
 * Cron-friendly endpoint to email owners before their better-auth API keys expire.
 * Protected by EDUAI_API_KEY (Authorization: Bearer …).
 */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405 });
  }

  const guard = await requireServiceKey(request);
  if (guard) return guard;

  const result = await sendApiKeyExpirationReminders();
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
