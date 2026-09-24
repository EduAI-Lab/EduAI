/**
 * The course-material file types Core accepts (#1785).
 *
 * One home for the list. The upload input's `accept` string and the server's
 * `validateFile` allow-list both read it, so a type cannot be advertised in the
 * UI without the server accepting it.
 *
 * The extraction switch in `~/lib/ai/file-processing` dispatches on MIME type
 * and cannot read a list, so `accepted-material-types-rag-path.test.ts` closes
 * that gap: it extracts a planted phrase from every entry here and fails if an
 * entry has no case.
 *
 * Deliberately not `.server`: the upload component ships this to the browser.
 */
export const ACCEPTED_MATERIAL_TYPES = [
  { extension: ".pdf", mimeType: "application/pdf" },
  {
    extension: ".docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  {
    extension: ".pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  { extension: ".txt", mimeType: "text/plain" },
  { extension: ".md", mimeType: "text/markdown" },
] as const;

export type AcceptedMaterialMimeType = (typeof ACCEPTED_MATERIAL_TYPES)[number]["mimeType"];

export const ACCEPTED_MATERIAL_MIME_TYPES: readonly AcceptedMaterialMimeType[] =
  ACCEPTED_MATERIAL_TYPES.map((type) => type.mimeType);

/** Value for the upload input's `accept`: extensions first, then MIME types. */
export const MATERIAL_INPUT_ACCEPT = [
  ...ACCEPTED_MATERIAL_TYPES.map((type) => type.extension),
  ...ACCEPTED_MATERIAL_MIME_TYPES,
].join(",");
