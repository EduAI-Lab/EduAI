/**
 * `GET`/`PATCH /api/admin/assistant-settings` — the help assistant's admin
 * toggles and tuning (#1817). ADMIN only on BOTH paths: the write re-checks the
 * role itself, so a replayed older payload from a since-demoted session cannot
 * reach the setter just because the page it came from was once rendered.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { jsonResponse as json } from "~/lib/api/json-response.server";
import {
  ASSISTANT_MAX_DOCS_MAX,
  ASSISTANT_MAX_DOCS_MIN,
  ASSISTANT_SETTING_DEFINITIONS,
  isSafeModelId,
} from "~/lib/assistant/assistant-settings";
import {
  getAssistantSettings,
  updateAssistantSettings,
} from "~/lib/assistant/assistant-settings.server";
import { requireAdmin } from "~/lib/auth/guards.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

const modelSetting = z
  .string()
  .trim()
  .max(160)
  .refine((value) => value === "" || isSafeModelId(value), {
    message: "Use provider:model with letters, digits and . _ : / @ + - only",
  });

const UpdateAssistantSettingsSchema = z
  .object({
    enableHelpAssistant: z.boolean(),
    enableStudentMaterialQuestions: z.boolean(),
    maxDocs: z.number().int().min(ASSISTANT_MAX_DOCS_MIN).max(ASSISTANT_MAX_DOCS_MAX),
    routerModel: modelSetting,
    defaultModel: modelSetting,
  })
  .partial()
  .strict();

export async function loader({ request }: LoaderFunctionArgs) {
  const { response: adminGuard } = await requireAdmin(request);
  if (adminGuard) return adminGuard;
  return json({
    settings: await getAssistantSettings(),
    definitions: ASSISTANT_SETTING_DEFINITIONS,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "PATCH") return json({ error: "Method not allowed" }, 405);

  const { response: adminGuard, session } = await requireAdmin(request);
  if (adminGuard) return adminGuard;

  const parsed = UpdateAssistantSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  const settings = await updateAssistantSettings(parsed.data, session.user.id);

  fireAndForget(
    logAuditAction({
      ...getActorContext(session.user),
      ...getRequestContext(request),
      actionCode: "ASSISTANT_SETTINGS_UPDATED",
      category: "AI_CONFIG",
      entityType: "AssistantSettings",
      entityId: "assistant",
      entityLabel: "Help assistant settings",
      details: parsed.data,
    }),
  );

  return json({ settings });
}
