/**
 * @file The assistant's client state, kept outside React (#1822).
 *
 * Core renders `CoreAppShell` per route, so the shell — and the widget inside it —
 * remounts on every navigation. Holding open/closed, the active view and the
 * threads here means clicking a cited guide page keeps the panel open on the next
 * page, and an answer that arrives after a navigation still lands in its thread.
 */
import { useSyncExternalStore } from "react";

import type { PublishedAssistantContext } from "~/lib/assistant/assistant-visibility";

import { askAssistant } from "./assistant-api";
import {
  clearThread,
  historyForRequest,
  loadThread,
  saveThread,
  type ThreadMessage,
} from "./assistant-thread";

type StoreState = {
  open: boolean;
  view: "chat" | "settings";
  /** Scope keys with a question in flight. */
  pending: ReadonlySet<string>;
  /** Pre-filled text for the composer (from the help page hand-off). */
  draft: string;
  /** Bumped whenever any thread changes, so subscribers re-read. */
  version: number;
};

let state: StoreState = { open: false, view: "chat", pending: new Set(), draft: "", version: 0 };
const threads = new Map<string, ThreadMessage[]>();
const listeners = new Set<() => void>();

function emit(next: Partial<StoreState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAssistantStore(): StoreState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

export function setAssistantOpen(open: boolean) {
  if (state.open !== open) emit({ open, view: open ? state.view : "chat" });
}

export function setAssistantView(view: StoreState["view"]) {
  emit({ view });
}

export function setAssistantDraft(draft: string) {
  emit({ draft });
}

function threadKey(userId: string, scopeKey: string) {
  return `${userId}|${scopeKey}`;
}

export function getThread(userId: string, scopeKey: string): ThreadMessage[] {
  const key = threadKey(userId, scopeKey);
  let thread = threads.get(key);
  if (!thread) {
    // Only ever called in the browser: the widget reads threads while open, and
    // the panel is never open during server rendering.
    thread = loadThread(userId, scopeKey);
    threads.set(key, thread);
  }
  return thread;
}

function setThread(userId: string, scopeKey: string, messages: ThreadMessage[]) {
  threads.set(threadKey(userId, scopeKey), messages);
  saveThread(userId, scopeKey, messages);
  emit({ version: state.version + 1 });
}

export function startNewConversation(userId: string, scopeKey: string) {
  threads.set(threadKey(userId, scopeKey), []);
  clearThread(userId, scopeKey);
  emit({ version: state.version + 1 });
}

export async function sendAssistantQuestion(input: {
  userId: string;
  scopeKey: string;
  question: string;
  context: PublishedAssistantContext | null;
}) {
  const { userId, scopeKey } = input;
  const question = input.question.trim();
  if (!question || state.pending.has(scopeKey)) return;

  const before = getThread(userId, scopeKey);
  const history = historyForRequest(before);
  setThread(userId, scopeKey, [...before, { role: "user", content: question }]);
  emit({ pending: new Set([...state.pending, scopeKey]) });

  const result = await askAssistant({ question, history, context: input.context });

  const pending = new Set(state.pending);
  pending.delete(scopeKey);
  const reply: ThreadMessage = result.ok
    ? { role: "assistant", content: result.answer, sources: result.sources }
    : { role: "assistant", content: "", error: { code: result.code, message: result.message } };
  setThread(userId, scopeKey, [...getThread(userId, scopeKey), reply]);
  emit({ pending });
}

/** Test seam. */
export function resetAssistantStoreForTests() {
  threads.clear();
  state = { open: false, view: "chat", pending: new Set(), draft: "", version: 0 };
}
