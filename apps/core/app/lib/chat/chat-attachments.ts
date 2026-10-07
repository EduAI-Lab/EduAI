/**
 * Chat attachment wire contract (#1902).
 *
 * A student's file reaches `/api/chat` as AI SDK v4 `experimental_attachments`
 * holding already-extracted text in a `text/plain` data URL. The message is
 * persisted as sent; only the model-bound copy is rewritten by
 * `toModelMessage`, which moves the text into fenced parts so the model reads
 * it as reference data. Stripping is load-bearing: left in place, the SDK's
 * own `attachmentsToParts` would turn it into bare, unfenced text.
 *
 * Image attachments are deliberately ignored here — `messageHasImageParts`
 * and the Course Chat image guard own them (#1266).
 */
import { z } from "zod";
import {
  CHAT_ATTACHMENT_MAX_FILES,
  CHAT_MAX_ATTACHMENT_CHARS_DEFAULT,
} from "~/lib/chat/attachment-types";

export type ChatTextAttachment = { name: string; contentType: "text/plain"; url: string };

export type AttachmentCarrier = {
  content?: unknown;
  parts?: unknown;
  experimental_attachments?: unknown;
};

export type ChatAttachmentRejectCode =
  | "ATTACHMENT_TYPE_UNSUPPORTED"
  | "ATTACHMENT_INVALID"
  | "ATTACHMENT_TOO_MANY"
  | "ATTACHMENT_BUDGET_EXCEEDED";

export type AttachmentParseResult =
  | { ok: true; attachments: Array<{ name: string; text: string }> }
  | { ok: false; status: 400 | 413; code: ChatAttachmentRejectCode; error: string };

const TEXT_DATA_URL_PREFIX = "data:text/plain;base64,";

export function encodeTextDataUrl(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `${TEXT_DATA_URL_PREFIX}${btoa(binary)}`;
}

export function decodeTextDataUrl(url: string): string | null {
  if (!url.startsWith(TEXT_DATA_URL_PREFIX)) return null;
  try {
    const binary = atob(url.slice(TEXT_DATA_URL_PREFIX.length));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function isImageAttachment<T extends { contentType?: string; url?: string }>(
  attachment: T,
): boolean {
  return (
    attachment.contentType?.startsWith("image/") === true ||
    attachment.url?.startsWith("data:image/") === true
  );
}

const rawAttachmentSchema = z.object({
  name: z.string().optional(),
  contentType: z.string().optional(),
  url: z.string(),
});

const reject = (
  status: 400 | 413,
  code: ChatAttachmentRejectCode,
  error: string,
): AttachmentParseResult => ({ ok: false, status, code, error });

export function parseMessageAttachments<T extends AttachmentCarrier>(
  message: T,
  maxChars: number = CHAT_MAX_ATTACHMENT_CHARS_DEFAULT,
): AttachmentParseResult {
  const raw = message.experimental_attachments;
  if (raw === undefined || raw === null) return { ok: true, attachments: [] };
  const list = z.array(rawAttachmentSchema).safeParse(raw);
  if (!list.success) {
    return reject(
      400,
      "ATTACHMENT_INVALID",
      "One of the attached files could not be read. Remove it and attach it again.",
    );
  }

  const attachments: Array<{ name: string; text: string }> = [];
  for (const item of list.data) {
    if (isImageAttachment(item)) continue;
    if (item.contentType !== "text/plain") {
      return reject(
        400,
        "ATTACHMENT_TYPE_UNSUPPORTED",
        "That file type can't be attached to a chat message.",
      );
    }
    const name = item.name?.trim() ?? "";
    const text = decodeTextDataUrl(item.url);
    if (name.length === 0 || name.length > 255 || text === null) {
      return reject(
        400,
        "ATTACHMENT_INVALID",
        "One of the attached files could not be read. Remove it and attach it again.",
      );
    }
    attachments.push({ name, text });
  }

  if (attachments.length > CHAT_ATTACHMENT_MAX_FILES) {
    return reject(
      400,
      "ATTACHMENT_TOO_MANY",
      `You can attach up to ${CHAT_ATTACHMENT_MAX_FILES} files to one message.`,
    );
  }
  const total = attachments.reduce((sum, a) => sum + a.text.length, 0);
  if (total > maxChars) {
    return reject(
      413,
      "ATTACHMENT_BUDGET_EXCEEDED",
      "The attached files are too long to send together. Remove one and try again.",
    );
  }
  return { ok: true, attachments };
}

const escapeAttribute = (value: string): string =>
  value
    .replace(/&/gu, "&amp;")
    .replace(/"/gu, "&quot;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");

export function fenceAttachment(attachment: { name: string; text: string }): string {
  const body = attachment.text.replace(/<\/(student_attachment)/giu, "<\\/$1");
  return `<student_attachment name="${escapeAttribute(attachment.name)}">\n${body}\n</student_attachment>`;
}

export function toModelMessage<T extends AttachmentCarrier>(message: T): T {
  const parsed = parseMessageAttachments(message, Number.POSITIVE_INFINITY);
  if (!parsed.ok || parsed.attachments.length === 0) return message;

  const fenced = parsed.attachments.map(fenceAttachment).join("\n\n");
  const images = z
    .array(rawAttachmentSchema)
    .parse(message.experimental_attachments)
    .filter((item) => isImageAttachment(item));
  const { experimental_attachments: _dropped, ...rest } = message;
  const next: AttachmentCarrier = { ...rest };

  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  if (typeof message.content === "string") {
    next.content = message.content.length > 0 ? `${message.content}\n\n${fenced}` : fenced;
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  if (Array.isArray(message.parts)) {
    next.parts = [...message.parts, { type: "text", text: fenced }];
  }
  if (images.length > 0) next.experimental_attachments = images;
  // SAFETY: `next` is `message` minus/plus only the three fields `T` declares
  // via `AttachmentCarrier`; every other property is copied through unchanged.
  return next as T;
}
