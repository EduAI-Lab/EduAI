import type { RbacUser } from "~/lib/auth/course-access.server";

export type ChatMode = "learning" | "admin";

export type ChatToolContext = {
  user: RbacUser;
  effectiveCourseId: string | null;
  effectiveCourseCode?: string | null;
};

export function parseChatMode(value: unknown): ChatMode {
  return value === "admin" ? "admin" : "learning";
}

export function chatbotTypeFromMode(mode: ChatMode): "LEARNING" | "ADMIN" {
  return mode === "admin" ? "ADMIN" : "LEARNING";
}
