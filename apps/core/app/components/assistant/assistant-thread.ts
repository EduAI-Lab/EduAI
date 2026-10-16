/**
 * @file Client-side conversation threads for the assistant (#1822).
 *
 * Nothing is persisted server-side, so history lives here and is resent with each
 * question. A thread is bound to its scope — one off-course thread, one per
 * course, one per material — so opening a different material starts a new
 * conversation. Threads live in `sessionStorage` (this tab only) and are keyed by
 * user, so a shared computer never shows one person's thread to the next.
 */
import { z } from "zod";

import type { PublishedAssistantContext } from "~/lib/assistant/assistant-visibility";

export const threadSourceSchema = z.object({ id: z.string(), title: z.string(), url: z.string() });
export type ThreadSource = z.infer<typeof threadSourceSchema>;

const threadMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  sources: z.array(threadSourceSchema).optional(),
  /** An error notice shown in the thread — never resent as history. */
  error: z.object({ code: z.string().nullable(), message: z.string() }).optional(),
});
export type ThreadMessage = z.infer<typeof threadMessageSchema>;

/** A stored thread; unreadable storage reads as an empty thread. */
const storedThread = z.array(threadMessageSchema).catch([]);

const MAX_STORED_MESSAGES = 40;

/** The scope a thread is bound to. Material scope only when the server granted it. */
export function threadScopeKey(context: PublishedAssistantContext | null): string {
  if (!context?.materialScope) return "global";
  return context.materialId ? `material:${context.materialId}` : `course:${context.courseId}`;
}

function storageKey(userId: string, scopeKey: string) {
  return `eduai.assistant.thread.${userId}.${scopeKey}`;
}

export function loadThread(userId: string, scopeKey: string): ThreadMessage[] {
  try {
    const raw = window.sessionStorage.getItem(storageKey(userId, scopeKey));
    return storedThread.parse(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function saveThread(userId: string, scopeKey: string, messages: ThreadMessage[]): void {
  try {
    window.sessionStorage.setItem(
      storageKey(userId, scopeKey),
      JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)),
    );
  } catch {
    // Storage full or blocked: the thread just won't survive a reload.
  }
}

export function clearThread(userId: string, scopeKey: string): void {
  try {
    window.sessionStorage.removeItem(storageKey(userId, scopeKey));
  } catch {
    // Nothing to do.
  }
}

/**
 * The history to resend: answered exchanges only. Error notices are dropped, and
 * so is a trailing question that never got an answer — the server enforces
 * alternation too, but the client should not send a broken thread to begin with.
 */
export function historyForRequest(
  messages: readonly ThreadMessage[],
): Array<{ role: "user" | "assistant"; content: string }> {
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.error) continue;
    if (message.role === "user") {
      const next = messages[i + 1];
      if (!next || next.role !== "assistant" || next.error) continue;
    }
    turns.push({ role: message.role, content: message.content.slice(0, 4000) });
  }
  return turns.slice(-20);
}
