import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { z } from "zod";

import { jsonResponse as json } from "~/lib/api/json-response.server";
import { requireAdmin } from "~/lib/auth/guards.server";
import {
  CHAT_DAILY_LIMIT_DEFINITIONS,
  CHAT_DAILY_LIMIT_MAX,
  normalizeChatDailyLimitSettings,
} from "~/lib/chat-daily-limits";
import {
  ChatDailyLimitSettingsUnavailableError,
  getChatDailyLimitSettings,
  setChatDailyLimitSettings,
} from "~/lib/chat-daily-limits.server";
import { fireAndForget, logAuditAction } from "~/lib/logging.server";
import { getActorContext, getRequestContext } from "~/lib/request-context.server";

const limitSchema = z.number().int().min(0).max(CHAT_DAILY_LIMIT_MAX);

const UpdateChatDailyLimitSettingsSchema = z.object({
  studentLimit: limitSchema,
  instructorLimit: limitSchema,
});

/**
 * `getChatDailyLimitSettings` throws `ChatDailyLimitSettingsUnavailableError`
 * only on a cold cache with Postgres unreachable (a warm cache keeps serving
 * the last-known settings through an outage) — the same condition
 * `/api/chat` already maps to a 503 rather than letting it surface as an
 * unhandled loader/action error (#1557 review).
 */
function chatDailyLimitUnavailableResponse() {
  return json(
    { error: "Daily message limits could not be loaded. Please try again shortly." },
    503,
  );
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { response: adminGuard } = await requireAdmin(request);
  if (adminGuard) return adminGuard;

  let settings;
  try {
    settings = await getChatDailyLimitSettings();
  } catch (error) {
    if (error instanceof ChatDailyLimitSettingsUnavailableError) {
      return chatDailyLimitUnavailableResponse();
    }
    throw error;
  }

  return json({ settings, definitions: CHAT_DAILY_LIMIT_DEFINITIONS });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "PATCH" && request.method !== "PUT") {
    return json({ error: "Method not allowed" }, 405);
  }

  const { response: adminGuard, session } = await requireAdmin(request);
  if (adminGuard) return adminGuard;

  const parsed = UpdateChatDailyLimitSettingsSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  const settings = await setChatDailyLimitSettings(
    normalizeChatDailyLimitSettings(parsed.data),
    session.user.id,
  );

  fireAndForget(
    logAuditAction({
      ...getActorContext(session.user),
      ...getRequestContext(request),
      actionCode: "CHAT_DAILY_LIMIT_SETTINGS_UPDATED",
      category: "AI_CONFIG",
      entityType: "ChatDailyLimit",
      entityId: "chat.daily",
      entityLabel: "Local chatbot daily caps",
      details: settings,
    }),
  );

  return json({ settings });
}
