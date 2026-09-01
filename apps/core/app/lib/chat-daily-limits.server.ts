import { UserRole } from "@prisma/client";

import {
  checkRateLimit,
  refundRateLimitCharge,
  type RateLimitResult,
} from "~/lib/auth/rate-limit.server";
import prisma from "~/lib/prisma.server";
import {
  CHAT_DAILY_LIMIT_DEFINITIONS,
  CHAT_DAILY_LIMIT_KEYS,
  CHAT_DAILY_LIMIT_PREFIX,
  CHAT_DAILY_WINDOW_MS,
  chatDailyLimitKey,
  defaultChatDailyLimitSettings,
  isChatDailyLimitKey,
  isLocalChatbotModel,
  parseChatDailyLimit,
  type ChatDailyLimitKey,
  type ChatDailyLimitSettings,
} from "~/lib/chat-daily-limits";

/**
 * `role` arrives as a plain string (better-auth's session type does not
 * carry the Prisma UserRole enum). Casting to UserRole here buys an
 * exhaustive switch below: a new UserRole added to schema.prisma without a
 * case below is a compile error at `_exhaustive`, forcing a conscious choice
 * of tier instead of silently defaulting into the instructor cap.
 *
 * Lives here (not in the shared `~/lib/chat-daily-limits` module) because it
 * needs the real `@prisma/client` runtime enum, not just its type — and that
 * module is also imported by a client component (`chat-daily-limit-settings`
 * on the admin settings page). Vite bundles `@prisma/client`'s browser stub
 * for the client, which has no runtime enum exports, so pulling this import
 * into the shared module breaks that route's client-side navigation (it
 * falls back to a full page reload instead of a SPA transition).
 *
 * SAFETY: every caller in this codebase (chat.ts, consumeLocalChatDailyCap
 * below) sources `role` from `actingUser.role`/session data that Prisma
 * populated from the UserRole column, so the runtime value is always a real
 * member of the enum; the `default` branch below still throws defensively if
 * that invariant is ever violated instead of misclassifying the caller's tier.
 */
export function dailyLimitForRole(
  role: string | undefined,
  settings: ChatDailyLimitSettings,
): number {
  // No resolved role (service-key/stateless callers) follows the staff cap
  // rather than the tighter student one.
  if (role === undefined) return settings.instructorLimit;

  const typedRole = role as UserRole;
  switch (typedRole) {
    case UserRole.STUDENT:
      return settings.studentLimit;
    case UserRole.INSTRUCTOR:
    case UserRole.ADMIN:
    case UserRole.UNIT_ADMIN:
      return settings.instructorLimit;
    default: {
      const _exhaustive: never = typedRole;
      throw new Error(`dailyLimitForRole: unhandled role "${String(_exhaustive)}"`);
    }
  }
}

const CACHE_TTL_MS = 10 * 1000;

let cache: { value: ChatDailyLimitSettings; expiresAt: number } | null = null;

export class ChatDailyLimitSettingsUnavailableError extends Error {
  constructor(message = "Local chatbot daily cap settings are unavailable") {
    super(message);
    this.name = "ChatDailyLimitSettingsUnavailableError";
  }
}

export function invalidateChatDailyLimitSettingsCache(): void {
  cache = null;
}

export async function getChatDailyLimitSettings(): Promise<ChatDailyLimitSettings> {
  if (cache && Date.now() < cache.expiresAt) {
    return cache.value;
  }

  try {
    const value = defaultChatDailyLimitSettings();
    const keys = CHAT_DAILY_LIMIT_KEYS.map((key) => CHAT_DAILY_LIMIT_PREFIX + key);
    const rows = await prisma.systemConfig.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true },
    });
    for (const row of rows) {
      const key = row.key.slice(CHAT_DAILY_LIMIT_PREFIX.length);
      if (isChatDailyLimitKey(key)) {
        value[key] = parseChatDailyLimit(row.value, value[key]);
      }
    }
    cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  } catch (error) {
    // Keep the last successful admin override if Postgres flakes after the
    // 10s TTL. Falling back to 50/200 would reopen a tightened cap.
    if (cache) {
      console.error(
        "[chat-daily-limits] SystemConfig read failed; keeping last-known caps",
        error instanceof Error ? error.message : error,
      );
      cache = { value: cache.value, expiresAt: Date.now() + CACHE_TTL_MS };
      return cache.value;
    }
    throw new ChatDailyLimitSettingsUnavailableError(
      error instanceof Error ? error.message : undefined,
    );
  }
}

export async function setChatDailyLimitSettings(
  settings: ChatDailyLimitSettings,
  updatedBy: string,
): Promise<ChatDailyLimitSettings> {
  for (const key of CHAT_DAILY_LIMIT_KEYS) {
    await upsertChatDailyLimitSetting(key, settings[key], updatedBy);
  }
  invalidateChatDailyLimitSettingsCache();
  return getChatDailyLimitSettings();
}

async function upsertChatDailyLimitSetting(
  key: ChatDailyLimitKey,
  value: number,
  updatedBy: string,
): Promise<void> {
  const definition = CHAT_DAILY_LIMIT_DEFINITIONS[key];
  await prisma.systemConfig.upsert({
    where: { key: CHAT_DAILY_LIMIT_PREFIX + key },
    create: {
      key: CHAT_DAILY_LIMIT_PREFIX + key,
      value: String(value),
      description: definition.description,
      updatedBy,
    },
    update: {
      value: String(value),
      updatedBy,
    },
  });
}

/**
 * Apply the admin daily cap for the local chatbot. Returns null when this
 * request is not a local-chatbot turn or the role's cap is 0 (uncapped).
 * Callers must pass the post-routing model id, not Auto.
 */
export async function consumeLocalChatDailyCap(options: {
  userId: string;
  role: string | undefined;
  model: string | undefined;
  settings?: ChatDailyLimitSettings;
}): Promise<RateLimitResult | null> {
  if (!isLocalChatbotModel(options.model)) return null;

  const settings = options.settings ?? (await getChatDailyLimitSettings());
  const limit = dailyLimitForRole(options.role, settings);
  if (limit <= 0) return null;

  return checkRateLimit(chatDailyLimitKey(options.userId), limit, CHAT_DAILY_WINDOW_MS);
}

/**
 * Undo a `consumeLocalChatDailyCap` charge, by the `reservationToken` that
 * call's `RateLimitResult` returned. The cap is reserved right after Auto
 * routing picks a local model, before admission/fleet resolution runs — if
 * the turn later overflows to Bedrock (admission timeout or fleet
 * exhaustion), it executed on cloud, not local, and must not count against
 * the local daily quota (the PR's contract: cloud turns are never counted).
 *
 * Callers only ever hold a `reservationToken` when `consumeLocalChatDailyCap`
 * actually charged (see `RateLimitResult.reservationToken`'s contract), so
 * there is no need to re-derive "would this have charged" from
 * `isLocalChatbotModel`/`dailyLimitForRole` here the way the pre-#1547-review
 * version did — the token's mere presence already proves it (#1547 review).
 */
export async function refundLocalChatDailyCap(options: {
  userId: string;
  reservationToken: string;
}): Promise<void> {
  await refundRateLimitCharge(chatDailyLimitKey(options.userId), options.reservationToken);
}
