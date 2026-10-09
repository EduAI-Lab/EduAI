/**
 * @file The page → assistant hand-off (#1822): a window-scoped publish/read pair.
 *
 * The assistant is mounted once in the app shell, while the course and material
 * views are separate route modules, so props cannot be threaded through. A page
 * publishes what the reader is looking at on mount and again whenever that
 * changes; the widget reads the latest value at any time (so mount order does not
 * matter) and listens for changes.
 *
 * What is published is a HINT, never an authorization — the server re-derives
 * access for every question.
 */
import { useEffect, useSyncExternalStore } from "react";
import { z } from "zod";

import type { PublishedAssistantContext } from "~/lib/assistant/assistant-visibility";

const CONTEXT_EVENT = "eduai:assistant-context";
const OPEN_EVENT = "eduai:assistant-open";
const CLEAR_MATERIAL_EVENT = "eduai:assistant-clear-material";

declare global {
  interface Window {
    __eduaiAssistantContext?: PublishedAssistantContext | null;
  }
}

// Every function below runs only in the browser — from effects, event handlers,
// or as `useSyncExternalStore`'s client snapshot (the server snapshot is `null`).

export function publishAssistantContext(context: PublishedAssistantContext | null): void {
  window.__eduaiAssistantContext = context;
  window.dispatchEvent(new CustomEvent(CONTEXT_EVENT));
}

export function readAssistantContext(): PublishedAssistantContext | null {
  return window.__eduaiAssistantContext ?? null;
}

function subscribeToContext(onChange: () => void): () => void {
  window.addEventListener(CONTEXT_EVENT, onChange);
  return () => window.removeEventListener(CONTEXT_EVENT, onChange);
}

/** The latest published context; re-renders when a page publishes a new one. */
export function usePublishedAssistantContext(): PublishedAssistantContext | null {
  return useSyncExternalStore(subscribeToContext, readAssistantContext, () => null);
}

function sameContext(
  a: PublishedAssistantContext | null | undefined,
  b: PublishedAssistantContext | null | undefined,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.courseId === b.courseId &&
    a.materialId === b.materialId &&
    a.label === b.label &&
    a.materialScope === b.materialScope
  );
}

/**
 * Publish `context` while the calling view is mounted, re-publishing when it
 * changes, and withdraw it on unmount so the next page starts clean.
 */
export function usePublishAssistantContext(context: PublishedAssistantContext | null): void {
  const courseId = context?.courseId ?? null;
  const materialId = context?.materialId ?? null;
  const label = context?.label ?? null;
  const materialScope = context?.materialScope ?? false;

  useEffect(() => {
    const next = courseId ? { courseId, materialId, label: label ?? "", materialScope } : null;
    if (!sameContext(readAssistantContext(), next)) publishAssistantContext(next);
  }, [courseId, materialId, label, materialScope]);

  useEffect(() => () => publishAssistantContext(null), []);
}

export type AssistantOpenRequest = { draft?: string };

/** An open request's detail; anything malformed reads as a plain "open". */
const openRequestDetail = z.object({ draft: z.string().max(2000).optional() }).catch({});

/** Ask the mounted assistant to open, optionally with a question pre-filled. */
export function requestAssistantOpen(detail: AssistantOpenRequest = {}): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail }));
}

export function onAssistantOpenRequest(
  handler: (detail: AssistantOpenRequest) => void,
): () => void {
  const listener = (event: Event) => {
    handler(openRequestDetail.parse(event instanceof CustomEvent ? event.detail : undefined));
  };
  window.addEventListener(OPEN_EVENT, listener);
  return () => window.removeEventListener(OPEN_EVENT, listener);
}

/** The widget asks the page to drop a pinned material and go back to course scope. */
export function requestClearMaterialScope(): void {
  window.dispatchEvent(new CustomEvent(CLEAR_MATERIAL_EVENT));
}

export function onClearMaterialScopeRequest(handler: () => void): () => void {
  window.addEventListener(CLEAR_MATERIAL_EVENT, handler);
  return () => window.removeEventListener(CLEAR_MATERIAL_EVENT, handler);
}
