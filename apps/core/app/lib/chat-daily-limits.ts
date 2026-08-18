/**
 * Admin-configurable daily caps for the local chatbot (#1547).
 *
 * Defaults: 50 messages/day per student, 200/day per instructor.
 * A cap of 0 means that role is not daily-capped.
 */

import {
  LOCAL_INFERENCE_PROVIDERS,
  parseModelIdentifier,
} from "~/lib/ai/provider-types";

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

export const CHAT_DAILY_LIMIT_DEFINITIONS: Record<
  ChatDailyLimitKey,
  { label: string; description: string }
> = {
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
};

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
  if (!model || model === "auto" || model === "auto-llm") return true;
  const parsed = parseModelIdentifier(model);
  if (!parsed) return true;
  return LOCAL_INFERENCE_PROVIDERS.includes(parsed.providerId);
}

export function dailyLimitForRole(
  role: string | undefined,
  settings: ChatDailyLimitSettings,
): number {
  if (role === "STUDENT") return settings.studentLimit;
  return settings.instructorLimit;
}

export function chatDailyLimitKey(userId: string): string {
  return `chat-daily:${userId}`;
}
