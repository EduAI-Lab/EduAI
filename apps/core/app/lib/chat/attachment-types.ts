/**
 * File types a student may attach to a chat message (#1902).
 *
 * Deliberately not `.server`: the composer's `accept` string reads the same
 * list the server enforces, so a type cannot be offered without being accepted.
 * Documents reuse the course-material pipeline (`accepted-types.ts`); code and
 * data files are decoded as UTF-8. Images are out of scope (#1742, #1266).
 */
import {
  ACCEPTED_MATERIAL_TYPES,
  type AcceptedMaterialMimeType,
} from "~/lib/materials/accepted-types";

export const CHAT_ATTACHMENT_MAX_FILES = 3;
export const CHAT_ATTACHMENT_MAX_BYTES_DEFAULT = 10 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_CHARS_DEFAULT = 20_000;
export const CHAT_MAX_ATTACHMENT_CHARS_DEFAULT = 60_000;

export const CHAT_ATTACHMENT_TEXT_EXTENSIONS: readonly string[] = [
  ".r",
  ".sql",
  ".py",
  ".java",
  ".js",
  ".ts",
  ".c",
  ".cpp",
  ".h",
  ".csv",
  ".json",
  ".html",
  ".css",
  ".sh",
];

export type AttachmentKind =
  | { kind: "document"; mimeType: AcceptedMaterialMimeType }
  | { kind: "text" };

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

/** How a file is turned into text, decided by its extension; `null` = not accepted. */
export function classifyAttachmentName(name: string): AttachmentKind | null {
  const extension = extensionOf(name);
  if (extension === "") return null;
  const document = ACCEPTED_MATERIAL_TYPES.find((type) => type.extension === extension);
  if (document) return { kind: "document", mimeType: document.mimeType };
  return CHAT_ATTACHMENT_TEXT_EXTENSIONS.includes(extension) ? { kind: "text" } : null;
}

/** Value for the composer's hidden `<input type="file" accept>`. */
export const CHAT_ATTACHMENT_ACCEPT = [
  ...ACCEPTED_MATERIAL_TYPES.map((type) => type.extension),
  ...CHAT_ATTACHMENT_TEXT_EXTENSIONS,
].join(",");
