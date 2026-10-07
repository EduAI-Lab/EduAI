/**
 * Turns one chat attachment into capped plain text (#1902).
 *
 * Documents go through the same extractors course materials use (isolated
 * PDF/DOCX worker, ZIP-bomb caps, magic-byte sniff), but not through
 * `extractUploadedFileContent`, which chunks for embedding and would leave
 * `--- CHUNK SEPARATOR ---` markers in what the model reads. Code and data
 * files are decoded as strict UTF-8; a NUL byte or invalid sequence means the
 * extension lied and the file is rejected rather than shown to the model.
 *
 * Dispatch is by extension, not declared MIME: browsers report `""` or
 * vendor types for `.R`/`.sql`/`.md`.
 */
import {
  PDF_NO_TEXT_LAYER_MESSAGE,
  extractDocxText,
  extractPdfText,
  extractPptxText,
  readFileAsText,
  sanitizeTextContent,
  validateFileSignature,
} from "~/lib/ai/file-processing";
import { parseEnvInt } from "~/lib/auth/rate-limit.server";
import {
  CHAT_ATTACHMENT_MAX_BYTES_DEFAULT,
  CHAT_ATTACHMENT_MAX_CHARS_DEFAULT,
  classifyAttachmentName,
} from "~/lib/chat/attachment-types";

export type ChatAttachmentErrorCode =
  | "ATTACHMENT_TYPE_UNSUPPORTED"
  | "ATTACHMENT_TOO_LARGE"
  | "ATTACHMENT_EMPTY"
  | "ATTACHMENT_EXTRACT_FAILED";

const STATUS = {
  ATTACHMENT_TYPE_UNSUPPORTED: 400,
  ATTACHMENT_TOO_LARGE: 413,
  ATTACHMENT_EMPTY: 422,
  ATTACHMENT_EXTRACT_FAILED: 422,
} as const satisfies Record<ChatAttachmentErrorCode, 400 | 413 | 422>;

const MESSAGES = {
  ATTACHMENT_TYPE_UNSUPPORTED:
    "This file type can't be attached. Try a PDF, Word, PowerPoint, text, or code file.",
  ATTACHMENT_TOO_LARGE: "This file is too large to attach.",
  ATTACHMENT_EMPTY: "This file has no readable text. A scanned document needs OCR first.",
  ATTACHMENT_EXTRACT_FAILED: "We couldn't read this file. Try again, or attach a different copy.",
} as const satisfies Record<ChatAttachmentErrorCode, string>;

export class ChatAttachmentError extends Error {
  readonly status: 400 | 413 | 422;

  constructor(
    readonly code: ChatAttachmentErrorCode,
    options?: { cause?: Error },
  ) {
    super(MESSAGES[code], options);
    this.name = "ChatAttachmentError";
    this.status = STATUS[code];
  }
}

export type ChatAttachmentExtraction = {
  name: string;
  contentType: "text/plain";
  text: string;
  truncated: boolean;
  charCount: number;
};

export type ChatAttachmentLimits = { maxBytes: number; maxChars: number };

export function resolveChatAttachmentLimits(): ChatAttachmentLimits {
  return {
    maxBytes: parseEnvInt(process.env.CHAT_ATTACHMENT_MAX_BYTES, CHAT_ATTACHMENT_MAX_BYTES_DEFAULT),
    maxChars: parseEnvInt(process.env.CHAT_ATTACHMENT_MAX_CHARS, CHAT_ATTACHMENT_MAX_CHARS_DEFAULT),
  };
}

async function decodeStrictText(file: File): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    throw readFailure(error instanceof Error ? error : new Error(String(error)));
  }
  if (bytes.includes(0)) throw new ChatAttachmentError("ATTACHMENT_TYPE_UNSUPPORTED");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ChatAttachmentError("ATTACHMENT_TYPE_UNSUPPORTED");
  }
}

function readFailure(error: Error): ChatAttachmentError {
  console.error("chat attachment extraction failed", error);
  return new ChatAttachmentError("ATTACHMENT_EXTRACT_FAILED", { cause: error });
}

async function extractDocument(file: File, mimeType: string): Promise<string> {
  try {
    const typed = new File([await file.arrayBuffer()], file.name, { type: mimeType });
    const signature = await validateFileSignature(typed);
    if (!signature.isValid) throw new ChatAttachmentError("ATTACHMENT_TYPE_UNSUPPORTED");
    switch (mimeType) {
      case "application/pdf":
        return (await extractPdfText(typed)).content;
      case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return (await extractDocxText(typed)).content;
      case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        return (await extractPptxText(typed)).content;
      default:
        return await readFileAsText(typed);
    }
  } catch (error) {
    if (error instanceof ChatAttachmentError) throw error;
    if (error instanceof Error && error.message.includes(PDF_NO_TEXT_LAYER_MESSAGE)) {
      throw new ChatAttachmentError("ATTACHMENT_EMPTY");
    }
    throw readFailure(error instanceof Error ? error : new Error(String(error)));
  }
}

const STRICT_TEXT_MIME_TYPES: readonly string[] = ["text/plain", "text/markdown"];

export async function extractChatAttachment(
  file: File,
  limits = resolveChatAttachmentLimits(),
): Promise<ChatAttachmentExtraction> {
  const kind = classifyAttachmentName(file.name);
  if (!kind) throw new ChatAttachmentError("ATTACHMENT_TYPE_UNSUPPORTED");
  if (file.size > limits.maxBytes) throw new ChatAttachmentError("ATTACHMENT_TOO_LARGE");

  const strict = kind.kind === "text" || STRICT_TEXT_MIME_TYPES.includes(kind.mimeType);
  const raw = strict ? await decodeStrictText(file) : await extractDocument(file, kind.mimeType);
  const clean = sanitizeTextContent(raw);
  if (clean.length === 0) throw new ChatAttachmentError("ATTACHMENT_EMPTY");

  const truncated = clean.length > limits.maxChars;
  const text = truncated ? clean.slice(0, limits.maxChars) : clean;
  return { name: file.name, contentType: "text/plain", text, truncated, charCount: text.length };
}
