import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { jsonResponse as json } from "~/lib/api/json-response.server";
import { requireAdmin } from "~/lib/auth/guards.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import {
  isRoutingModelSettingKey,
  routingModelSettingDefinitions,
} from "~/lib/routing-model-settings";
import {
  getRoutingModelSettings,
  setRoutingModelSetting,
} from "~/lib/routing-model-settings.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { response: adminGuard } = await requireAdmin(request);
  if (adminGuard) return adminGuard;

  return json({
    settings: await getRoutingModelSettings(),
    definitions: routingModelSettingDefinitions(),
  });
}

const UpdateRoutingModelSettingSchema = z.object({
  key: z.string(),
  value: z.boolean(),
});

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "PATCH" && request.method !== "PUT") {
    return json({ error: "Method not allowed" }, 405);
  }

  const { response: adminGuard, session } = await requireAdmin(request);
  if (adminGuard) return adminGuard;

  const parsed = UpdateRoutingModelSettingSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }
  if (!isRoutingModelSettingKey(parsed.data.key)) {
    return json({ error: "Unknown routing model setting" }, 404);
  }

  await setRoutingModelSetting(
    parsed.data.key,
    parsed.data.value,
    session.user.id,
  );

  fireAndForget(
    logAuditAction({
      ...getActorContext(session.user),
      ...getRequestContext(request),
      actionCode: "ROUTING_MODEL_SETTING_UPDATED",
      category: "AI_CONFIG",
      entityType: "RoutingModel",
      entityId: parsed.data.key,
      entityLabel: parsed.data.key,
      details: { key: parsed.data.key, value: parsed.data.value },
    }),
  );

  return json({ settings: await getRoutingModelSettings() });
}
