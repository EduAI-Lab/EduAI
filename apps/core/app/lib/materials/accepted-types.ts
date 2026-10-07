/**
 * The course-material file types Core accepts (#1785).
 *
 * One home for the list. The upload input's `accept` string, the server's
 * `validateFile` allow-list and error text, and the Canvas importer's MIME set
 * and extension map all read it, so a type cannot be advertised in the UI
 * without the server accepting it.
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
  { extension: ".txt", mimeType: "text/plain" },
  { extension: ".md", mimeType: "text/markdown" },
  {
    extension: ".docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  {
    extension: ".pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  // Images (#1903): transcribed to text by a vision model at ingest. Upload-only:
  // the Canvas importer filters these out (see `isImageMaterialMimeType`).
  { extension: ".png", mimeType: "image/png" },
  { extension: ".jpg", mimeType: "image/jpeg" },
  { extension: ".jpeg", mimeType: "image/jpeg" },
  { extension: ".webp", mimeType: "image/webp" },
] as const;

export type AcceptedMaterialMimeType = (typeof ACCEPTED_MATERIAL_TYPES)[number]["mimeType"];

const IMAGE_MATERIAL_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/** True for the image entries above, which need a vision model rather than a text parser. */
export function isImageMaterialMimeType(mimeType: string): boolean {
  return IMAGE_MATERIAL_MIME_TYPES.has(mimeType);
}

// Deduplicated: `.jpg` and `.jpeg` are two extensions for one MIME type.
export const ACCEPTED_MATERIAL_MIME_TYPES: readonly AcceptedMaterialMimeType[] = [
  ...new Set(ACCEPTED_MATERIAL_TYPES.map((type) => type.mimeType)),
];

/** Value for the upload input's `accept`: extensions first, then MIME types. */
export const MATERIAL_INPUT_ACCEPT = [
  ...ACCEPTED_MATERIAL_TYPES.map((type) => type.extension),
  ...ACCEPTED_MATERIAL_MIME_TYPES,
].join(",");

/** Extension (with dot, lowercase) to MIME type, for filename-driven lookups. */
export const MATERIAL_MIME_BY_EXTENSION: ReadonlyMap<string, AcceptedMaterialMimeType> = new Map(
  ACCEPTED_MATERIAL_TYPES.map((type) => [type.extension, type.mimeType]),
);

/** Human-readable list for error text, e.g. "PDF, TXT, MD, DOCX, PPTX, PNG, JPG, JPEG, WEBP". */
export const ACCEPTED_MATERIAL_TYPE_LABELS: string = ACCEPTED_MATERIAL_TYPES.map((type) =>
  type.extension.slice(1).toUpperCase(),
).join(", ");

/**
 * The MIME type to treat an upload as. Browsers (notably Chrome/Edge on
 * Windows) report "" for `.md`, which the input's `accept` still offers, so an
 * empty declared type falls back to the filename extension. A non-empty type is
 * returned unchanged: the server never overrides what the client declared, and
 * an unknown extension with an empty type resolves to "" (rejected downstream).
 */
export function resolveMaterialMimeType(file: { name?: string; type?: string }): string {
  const declared = file.type ?? "";
  if (declared !== "") return declared;
  const name = (file.name ?? "").toLowerCase();
  for (const [extension, mimeType] of MATERIAL_MIME_BY_EXTENSION) {
    if (name.endsWith(extension)) return mimeType;
  }
  return "";
}
