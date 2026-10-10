// app/components/chat/use-chat-attachments.ts
import { useCallback, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { CHAT_ATTACHMENT_MAX_FILES, classifyAttachmentName } from "~/lib/chat/attachment-types";
import { encodeTextDataUrl, type ChatTextAttachment } from "~/lib/chat/chat-attachments";

export type ChatAttachmentItem = {
  id: string;
  name: string;
  status: "pending" | "ready" | "failed";
  truncated: boolean;
  error: string | null;
  /** True only for a failed item whose type is supported, i.e. an upload failure. */
  retryable: boolean;
};

const successSchema = z.object({ text: z.string(), truncated: z.boolean() });
const failureSchema = z.object({ error: z.string() });
const FALLBACK_ERROR = "We couldn't read this file. Try again, or attach a different copy.";
const NETWORK_ERROR = "Couldn't upload this file. Check your connection and try again.";

/** Upload one file to `/api/chat/attachments` and return its extracted text. */
export async function uploadChatAttachment(
  file: File,
  signal?: AbortSignal,
): Promise<{ text: string; truncated: boolean }> {
  const form = new FormData();
  form.append("file", file);
  let response: Response;
  try {
    response = await fetch("/api/chat/attachments", { method: "POST", body: form, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(NETWORK_ERROR, { cause: error });
  }
  const body = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = successSchema.safeParse(body);
    if (parsed.success) return parsed.data;
  }
  const failure = failureSchema.safeParse(body);
  throw new Error(failure.success ? failure.data.error : FALLBACK_ERROR);
}

type Entry = Omit<ChatAttachmentItem, "retryable"> & { text: string | null };

export function useChatAttachments(options: { upload?: typeof uploadChatAttachment } = {}) {
  const upload = options.upload ?? uploadChatAttachment;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [limitError, setLimitError] = useState<string | null>(null);
  const live = useRef(new Map<string, { file: File; status: ChatAttachmentItem["status"] }>());

  const patch = useCallback((id: string, next: Partial<Entry>) => {
    const tracked = live.current.get(id);
    if (!tracked) return;
    if (next.status) tracked.status = next.status;
    setEntries((current) => current.map((e) => (e.id === id ? { ...e, ...next } : e)));
  }, []);

  const start = useCallback(
    (id: string, file: File) => {
      upload(file)
        .then((result) =>
          patch(id, {
            status: "ready",
            text: result.text,
            truncated: result.truncated,
            error: null,
          }),
        )
        .catch((error: Error) =>
          patch(id, { status: "failed", error: error.message || FALLBACK_ERROR }),
        );
    },
    [patch, upload],
  );

  const add = useCallback(
    (files: File[]) => {
      const room = CHAT_ATTACHMENT_MAX_FILES - live.current.size;
      const accepted = files.slice(0, Math.max(0, room));
      setLimitError(
        files.length > accepted.length
          ? `You can attach up to ${CHAT_ATTACHMENT_MAX_FILES} files to one message.`
          : null,
      );
      const created = accepted.map((file): Entry => {
        const id = crypto.randomUUID();
        live.current.set(id, {
          file,
          status: classifyAttachmentName(file.name) !== null ? "pending" : "failed",
        });
        const supported = classifyAttachmentName(file.name) !== null;
        return {
          id,
          name: file.name,
          status: supported ? "pending" : "failed",
          truncated: false,
          error: supported
            ? null
            : "This file type can't be attached. Try a PDF, Word, PowerPoint, text, or code file.",
          text: null,
        };
      });
      setEntries((current) => [...current, ...created]);
      for (const entry of created) {
        const tracked = live.current.get(entry.id);
        if (tracked && entry.status === "pending") start(entry.id, tracked.file);
      }
    },
    [start],
  );

  const remove = useCallback((id: string) => {
    live.current.delete(id);
    setLimitError(null);
    setEntries((current) => current.filter((e) => e.id !== id));
  }, []);

  const retry = useCallback(
    (id: string) => {
      const tracked = live.current.get(id);
      if (
        !tracked ||
        tracked.status !== "failed" ||
        classifyAttachmentName(tracked.file.name) === null
      )
        return;
      patch(id, { status: "pending", error: null });
      start(id, tracked.file);
    },
    [patch, start],
  );

  const clear = useCallback(() => {
    live.current.clear();
    setLimitError(null);
    setEntries([]);
  }, []);

  const items = useMemo<ChatAttachmentItem[]>(
    () =>
      entries.map(({ id, name, status, truncated, error }) => ({
        id,
        name,
        status,
        truncated,
        error,
        retryable: status === "failed" && classifyAttachmentName(name) !== null,
      })),
    [entries],
  );
  const attachments = useMemo<ChatTextAttachment[]>(
    () =>
      entries.flatMap((e) =>
        e.status === "ready" && e.text !== null
          ? [{ name: e.name, contentType: "text/plain" as const, url: encodeTextDataUrl(e.text) }]
          : [],
      ),
    [entries],
  );
  const isBlocking = entries.some((e) => e.status !== "ready");

  return { items, add, remove, retry, clear, attachments, isBlocking, limitError };
}
