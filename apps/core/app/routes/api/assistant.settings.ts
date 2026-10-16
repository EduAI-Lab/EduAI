/**
 * `GET  /api/assistant/settings` — the settings pane's options (60/min).
 * `POST /api/assistant/settings` — save provider + model, optionally a key or a
 *                                  key removal, and the user's own curation (20/min).
 *
 * Not gated on the assistant gate (#1823): this edits the user's own stored
 * preference, which stays valid and worth correcting while the assistant is off.
 * The read is throttled far looser on purpose — the pane fires it on every open
 * and after each save, and a write-tight limit would lock a user out of merely
 * looking at their own settings.
 *
 * The key is write-only: no response ever contains it, and a rejected save never
 * echoes the request back.
 */
import { z } from "zod";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  readAssistantUserSettings,
  removeAssistantKey,
  saveAssistantUserSettings,
} from "~/lib/assistant/assistant-user-settings.server";
import { jsonResponse, requireSessionUser, throttle } from "~/lib/assistant/route-helpers.server";
import { readBoundedJson } from "~/lib/chat-input.server";
import { withErrorResponse } from "~/lib/errors.server";

const SETTINGS_MAX_BODY_BYTES = 32 * 1024;

const saveSchema = z
  .object({
    provider: z.string().min(1).max(64),
    model: z.string().min(1).max(128),
    apiKey: z.string().max(512).optional(),
    removeKey: z.boolean().optional(),
    enabledModels: z.array(z.string().max(128)).max(200).nullable().optional(),
  })
  .strict();

const removeKeySchema = z.object({ provider: z.string().min(1).max(64) }).strict();

export async function loader({ request }: LoaderFunctionArgs) {
  return withErrorResponse(
    async () => {
      const user = await requireSessionUser(request);
      if (!user) return jsonResponse(401, { error: "Unauthorized" });
      const limited = await throttle("assistant-settings-read", user.id, 60);
      if (limited) return limited;
      return jsonResponse(200, await readAssistantUserSettings(user.id));
    },
    { request },
  );
}

export async function action({ request }: ActionFunctionArgs) {
  return withErrorResponse(
    async () => {
      if (request.method !== "POST" && request.method !== "DELETE") {
        return jsonResponse(405, { error: "Method not allowed" });
      }
      const user = await requireSessionUser(request);
      if (!user) return jsonResponse(401, { error: "Unauthorized" });
      const limited = await throttle("assistant-settings-write", user.id, 20);
      if (limited) return limited;

      const body = await readBoundedJson(
        request,
        SETTINGS_MAX_BODY_BYTES,
        "Request body too large",
      );
      if (!body.ok) return jsonResponse(body.status, { error: body.error });

      if (request.method === "DELETE") {
        const parsed = removeKeySchema.safeParse(body.body);
        if (!parsed.success) return jsonResponse(422, { error: "VALIDATION_ERROR" });
        return jsonResponse(200, await removeAssistantKey(user.id, parsed.data.provider));
      }

      const parsed = saveSchema.safeParse(body.body);
      // Field paths only — never the submitted values, which may include a key.
      if (!parsed.success) {
        return jsonResponse(422, {
          error: "VALIDATION_ERROR",
          fields: parsed.error.issues.map((issue) => issue.path.join(".")),
        });
      }
      const result = await saveAssistantUserSettings(user.id, parsed.data);
      if (!result.ok) return jsonResponse(result.status, { error: result.error });
      return jsonResponse(200, result.settings);
    },
    { request },
  );
}
