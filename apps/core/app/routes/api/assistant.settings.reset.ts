/**
 * `POST /api/assistant/settings/reset` — back to the administrator's default
 * (20/min). Keeps every saved key: clearing a choice and removing a key are two
 * distinct intents (#1818), and conflating them makes one click silently undo the
 * other.
 */
import type { ActionFunctionArgs } from "react-router";

import { readAssistantUserSettings } from "~/lib/assistant/assistant-user-settings.server";
import { jsonResponse, requireSessionUser, throttle } from "~/lib/assistant/route-helpers.server";
import { clearChoice } from "~/lib/assistant/user-ai-keys.server";
import { withErrorResponse } from "~/lib/errors.server";

export async function action({ request }: ActionFunctionArgs) {
  return withErrorResponse(
    async () => {
      if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
      const user = await requireSessionUser(request);
      if (!user) return jsonResponse(401, { error: "Unauthorized" });
      const limited = await throttle("assistant-settings-write", user.id, 20);
      if (limited) return limited;
      await clearChoice(user.id);
      return jsonResponse(200, await readAssistantUserSettings(user.id));
    },
    { request },
  );
}
