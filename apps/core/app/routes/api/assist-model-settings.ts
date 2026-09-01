import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { jsonResponse as json } from "~/lib/api/json-response.server";
import { resolveActiveChatModel } from "~/lib/ai/providers.server";
import { requireAdmin } from "~/lib/auth/guards.server";
import { getAssistModelId, setAssistModelId } from "~/lib/assist-model-settings.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

const UpdateAssistModelSchema = z.object({
  modelId: z.string().trim().min(1).nullable(),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const { response: adminGuard } = await requireAdmin(request);
  if (adminGuard) return adminGuard;

  return json({ modelId: await getAssistModelId() });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "PATCH" && request.method !== "PUT") {
    return json({ error: "Method not allowed" }, 405);
  }

  const { response: adminGuard, session } = await requireAdmin(request);
  if (adminGuard) return adminGuard;

  const parsed = UpdateAssistModelSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Invalid Assist model setting", details: parsed.error.flatten() }, 400);
  }

  if (parsed.data.modelId !== null && !(await resolveActiveChatModel(parsed.data.modelId))) {
    return json({ error: "Assist model must be an active chat model" }, 404);
  }

  await setAssistModelId(parsed.data.modelId, session.user.id);
  fireAndForget(
    logAuditAction({
      ...getActorContext(session.user),
      ...getRequestContext(request),
      actionCode: "ASSIST_MODEL_UPDATED",
      category: "AI_CONFIG",
      entityType: "AssistModel",
      entityId: "routing.assistModelId",
      entityLabel: "AI Assist model",
      details: { modelId: parsed.data.modelId },
    }),
  );

  return json({ modelId: await getAssistModelId() });
}
