import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { jsonResponse as json } from "~/lib/api/json-response.server";
import { requireAdmin } from "~/lib/auth/guards.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";
import {
  BEDROCK_LIMIT_MAX,
  BEDROCK_OVERFLOW_SETTING_DEFINITIONS,
  normalizeBedrockOverflowSettings,
} from "~/lib/ai/routing/bedrock/bedrock-settings";
import {
  getBedrockOverflowSettings,
  setBedrockOverflowSettings,
} from "~/lib/ai/routing/bedrock/bedrock-settings.server";
import { isBedrockTokenConfigured } from "~/lib/ai/routing/bedrock/overflow.server";

const limitSchema = z.number().int().min(0).max(BEDROCK_LIMIT_MAX);

const UpdateBedrockOverflowSettingsSchema = z.object({
  enabled: z.boolean(),
  dailyUserLimit: limitSchema,
  monthlyUserLimit: limitSchema,
  globalLimit: limitSchema,
  resourceLimit: limitSchema,
});

export async function loader({ request }: LoaderFunctionArgs) {
  const { response: adminGuard } = await requireAdmin(request);
  if (adminGuard) return adminGuard;

  return json({
    settings: await getBedrockOverflowSettings(),
    tokenConfigured: isBedrockTokenConfigured(),
    definitions: BEDROCK_OVERFLOW_SETTING_DEFINITIONS,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "PATCH" && request.method !== "PUT") {
    return json({ error: "Method not allowed" }, 405);
  }

  const { response: adminGuard, session } = await requireAdmin(request);
  if (adminGuard) return adminGuard;
  if (!session?.user) {
    return json({ error: "Forbidden: Admins only" }, 403);
  }

  const parsed = UpdateBedrockOverflowSettingsSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  const settings = await setBedrockOverflowSettings(
    normalizeBedrockOverflowSettings(parsed.data),
    session.user.id,
  );

  fireAndForget(
    logAuditAction({
      ...getActorContext(session.user),
      ...getRequestContext(request),
      actionCode: "BEDROCK_OVERFLOW_SETTINGS_UPDATED",
      category: "AI_CONFIG",
      entityType: "BedrockOverflow",
      entityId: "bedrock.overflow",
      entityLabel: "AWS Bedrock overflow",
      details: settings,
    }),
  );

  return json({
    settings,
    tokenConfigured: isBedrockTokenConfigured(),
  });
}
