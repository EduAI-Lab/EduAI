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

type RawAttachment = z.infer<typeof rawAttachmentSchema>;

const reject = (
  status: 400 | 413,
  code: ChatAttachmentRejectCode,
  error: string,
): AttachmentParseResult => ({ ok: false, status, code, error });

/**
 * Try to decode a single attachment as a text attachment.
 * Returns null if the attachment is invalid, an image, or fails to decode.
 * Used by both parseMessageAttachments (for validation) and toModelMessage (for safe extraction).
 */
function tryDecodeTextAttachment(item: RawAttachment): { name: string; text: string } | null {
  const parsed = rawAttachmentSchema.safeParse(item);
  if (!parsed.success) return null;

  // Skip images
  if (isImageAttachment(parsed.data)) return null;

  // Only text/plain
  if (parsed.data.contentType !== "text/plain") return null;

  // Validate name
  const name = parsed.data.name?.trim() ?? "";
  if (name.length === 0 || name.length > 255) return null;

  // Decode URL
  const text = decodeTextDataUrl(parsed.data.url);
  if (text === null) return null;

  return { name, text };
}

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
    const decoded = tryDecodeTextAttachment(item);
    if (!decoded) {
      return reject(
        400,
        "ATTACHMENT_INVALID",
        "One of the attached files could not be read. Remove it and attach it again.",
      );
    }
    attachments.push(decoded);
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
  // If no experimental_attachments, return unchanged to preserve object reference
  if (message.experimental_attachments === undefined || message.experimental_attachments === null) {
    return message;
  }

  // Parse raw attachments
  const list = z.array(rawAttachmentSchema).safeParse(message.experimental_attachments);
  if (!list.success) {
    // Invalid format: remove attachments, return
    const { experimental_attachments: _removed, ...rest } = message;
    // SAFETY: `rest` has removed only the `experimental_attachments` field; all other
    // properties match `T` via `AttachmentCarrier` spread.
    return rest as T;
  }

  // Decode and fence valid text attachments, collect images
  const validTextAttachments: Array<{ name: string; text: string }> = [];
  const images: Array<unknown> = [];

  for (const item of list.data) {
    if (isImageAttachment(item)) {
      images.push(item);
      continue;
    }

    // Try to decode as text
    const decoded = tryDecodeTextAttachment(item);
    if (decoded) {
      validTextAttachments.push(decoded);
    }
    // If decode fails, silently drop it (fail closed)
  }

  // If nothing was valid and no images, remove experimental_attachments
  if (validTextAttachments.length === 0 && images.length === 0) {
    const { experimental_attachments: _removed, ...rest } = message;
    // SAFETY: `rest` has removed only the `experimental_attachments` field; all other
    // properties match `T` via `AttachmentCarrier` spread.
    return rest as T;
  }

  // Fence the valid text attachments
  const fenced = validTextAttachments.map(fenceAttachment).join("\n\n");

  // Build the result
  const { experimental_attachments: _removed, ...rest } = message;
  const next: AttachmentCarrier = { ...rest };

  // Update content and/or parts
  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  if (typeof message.content === "string") {
    next.content = message.content.length > 0 ? `${message.content}\n\n${fenced}` : fenced;
  }
  if (Array.isArray(message.parts)) {
    next.parts = [...message.parts, { type: "text", text: fenced }];
  }
  // If neither content nor parts, set content to avoid silent loss
  // oxlint-disable-next-line anti-slop/no-runtime-typeof
  if (typeof message.content !== "string" && !Array.isArray(message.parts)) {
    next.content = fenced;
  }

  // Keep images if any
  if (images.length > 0) {
    next.experimental_attachments = images;
  }

  // SAFETY: `next` is `message` minus/plus only the three fields `T` declares
  // via `AttachmentCarrier`; every other property is copied through unchanged.
  return next as T;
}
