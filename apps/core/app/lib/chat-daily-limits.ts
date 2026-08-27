/**
 * Admin-configurable daily caps for the local chatbot (#1547).
 *
 * Defaults: 50 messages/day per student, 200/day per instructor.
 * A cap of 0 means that role is not daily-capped.
 */

import { UserRole } from "@prisma/client";

import { LOCAL_INFERENCE_PROVIDERS, parseModelIdentifier } from "~/lib/ai/provider-types";

export const CHAT_DAILY_LIMIT_PREFIX = "chat.daily.";
export const CHAT_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const CHAT_DAILY_LIMIT_MAX = 1_000_000;
export const DEFAULT_STUDENT_DAILY_LIMIT = 50;
export const DEFAULT_INSTRUCTOR_DAILY_LIMIT = 200;

export const CHAT_DAILY_LIMIT_KEYS = ["studentLimit", "instructorLimit"] as const;

export type ChatDailyLimitKey = (typeof CHAT_DAILY_LIMIT_KEYS)[number];

export type ChatDailyLimitSettings = {
  studentLimit: number;
  instructorLimit: number;
};

export const DEFAULT_CHAT_DAILY_LIMIT_SETTINGS: ChatDailyLimitSettings = {
  studentLimit: DEFAULT_STUDENT_DAILY_LIMIT,
  instructorLimit: DEFAULT_INSTRUCTOR_DAILY_LIMIT,
};

export const CHAT_DAILY_LIMIT_DEFINITIONS = {
  studentLimit: {
    label: "Student daily cap",
    description:
      "Maximum local-chatbot messages one student may send in 24 hours. Default 50. 0 disables the daily cap for students.",
  },
  instructorLimit: {
    label: "Instructor daily cap",
    description:
      "Maximum local-chatbot messages one instructor (or other staff role) may send in 24 hours. Default 200. 0 disables the daily cap for that role.",
  },
} satisfies Record<ChatDailyLimitKey, { label: string; description: string }>;

export function defaultChatDailyLimitSettings(): ChatDailyLimitSettings {
  return { ...DEFAULT_CHAT_DAILY_LIMIT_SETTINGS };
}

export function isChatDailyLimitKey(value: string): value is ChatDailyLimitKey {
  return (CHAT_DAILY_LIMIT_KEYS as readonly string[]).includes(value);
}

export function parseChatDailyLimit(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(CHAT_DAILY_LIMIT_MAX, Math.floor(parsed)));
}

export function normalizeChatDailyLimitSettings(
  input: Partial<ChatDailyLimitSettings>,
): ChatDailyLimitSettings {
  return {
    studentLimit: parseChatDailyLimit(
      String(input.studentLimit ?? DEFAULT_STUDENT_DAILY_LIMIT),
      DEFAULT_STUDENT_DAILY_LIMIT,
    ),
    instructorLimit: parseChatDailyLimit(
      String(input.instructorLimit ?? DEFAULT_INSTRUCTOR_DAILY_LIMIT),
      DEFAULT_INSTRUCTOR_DAILY_LIMIT,
    ),
  };
}

export function isLocalChatbotModel(model: string | undefined): boolean {
  // Only concrete local providers count. Auto/unknown ids are decided after
  // routing resolves to a provider:model id.
  if (!model) return false;
  const parsed = parseModelIdentifier(model);
  if (!parsed) return false;
  return LOCAL_INFERENCE_PROVIDERS.includes(parsed.providerId);
}

export function dailyLimitForRole(
  role: string | undefined,
  settings: ChatDailyLimitSettings,
): number {
  // No resolved role (service-key/stateless callers) follows the staff cap
  // rather than the tighter student one.
  if (role === undefined) return settings.instructorLimit;

  // `role` arrives as a plain string (better-auth's session type does not
  // carry the Prisma UserRole enum). Casting to UserRole here buys an
  // exhaustive switch below: a new UserRole added to schema.prisma without a
  // case below is a compile error at `_exhaustive`, forcing a conscious
  // choice of tier instead of silently defaulting into the instructor cap.
  // SAFETY: every caller in this codebase (chat.ts, chat-daily-limits.server.ts)
  // sources `role` from `actingUser.role`/session data that Prisma populated
  // from the UserRole column, so the runtime value is always a real member of
  // the enum; the `default` branch below still throws defensively if that
  // invariant is ever violated instead of misclassifying the caller's tier.
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

export function chatDailyLimitKey(userId: string): string {
  return `chat-daily:${userId}`;
}
