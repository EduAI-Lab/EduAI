// Shared typed-error hierarchy (#1279). The `.js` specifier is required: the
// emitted `dist/index.js` is loaded directly by Node ESM consumers
// (ai-tutor/server, question-maker backend), which do not resolve extensionless
// relative imports even though `moduleResolution: bundler` accepts them here.
export * from "./errors.js";

// Prisma dropped UserRole.TA in Core (the unify migration) — a course TA is a
// STUDENT-platform user with an EnrollmentRole.TA enrollment. Platform UserRole
// no longer includes TA (#225 AUTH-12); course-level TA stays on EnrollmentRole.
export type UserRole = "ADMIN" | "UNIT_ADMIN" | "INSTRUCTOR" | "STUDENT";

export type EnrollmentRole = "INSTRUCTOR" | "TA" | "STUDENT";

// Runtime constants for JavaScript consumers (e.g. QM backend)
export const USER_ROLE_VALUES = [
  "ADMIN",
  "UNIT_ADMIN",
  "INSTRUCTOR",
  "STUDENT",
] as const satisfies readonly UserRole[];

export const ENROLLMENT_ROLE_VALUES = [
  "INSTRUCTOR",
  "TA",
  "STUDENT",
] as const satisfies readonly EnrollmentRole[];

/**
 * Prefer an explicit has* flag from the list API; otherwise treat a non-empty
 * string body as present. Shared so AI Tutor / QM enablement stays in lockstep.
 */
export function hasAttachmentContent(
  value: string | null | undefined,
  flag?: boolean | null,
): boolean {
  return Boolean(flag ?? (value != null && value !== ""));
}

// Canvas material sync
export type CanvasMaterialImportStatus = "not_imported" | "imported" | "updated_on_canvas";

export type CanvasMaterialDiscoverItem = {
  canvasFileId: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  canvasUpdatedAt: string;
  importStatus: CanvasMaterialImportStatus;
  coreMaterialId: string | null;
  isPublished: boolean;
  isExcluded: boolean;
};

export type CanvasMaterialSkipReason = "unpublished" | "excluded" | "not-modified";

export type SyncCanvasMaterialsResult = {
  imported: number;
  updated: number;
  skipped: number;
  skippedItems: Array<{ canvasFileId: string; reason: CanvasMaterialSkipReason }>;
  failed: Array<{ canvasFileId: string; message: string }>;
};

// Campus-model size ranking for QM pickers/probes. Shared here so the QM
// frontend doesn't need to reach into the QM backend's src/ to reuse it.
export const MODEL_SIZE_RANK_PATTERNS: ReadonlyArray<readonly [RegExp, number]> = Object.freeze([
  [/\b70b\b/, 70],
  [/\b32b\b/, 32],
  [/\b27b\b/, 27],
  [/\b14b\b/, 14],
  [/\b9b\b/, 9],
  [/\b7b\b/, 7],
  [/\b4b\b/, 4],
  [/\b3b\b/, 3],
  [/\b2b\b/, 2],
]);

/** Rank a model id/label string by parameter-size token (higher = larger). */
export function modelSizeRankFromText(text: string | null | undefined): number {
  const lower = String(text ?? "").toLowerCase();
  for (const [pattern, rank] of MODEL_SIZE_RANK_PATTERNS) {
    if (pattern.test(lower)) return rank;
  }
  return 0;
}

/**
 * A JSON value, as it exists after `JSON.parse` and before anything gives it a
 * domain meaning.
 *
 * Use this only where a payload is genuinely open-ended — a `Json` column read
 * back verbatim, a request body a layer forwards without owning, arguments an
 * external caller chose. Where the shape *is* known, name it or derive it from
 * the schema that parses it; reaching for `JsonValue` there just relabels
 * `unknown` and loses the same contract.
 *
 * It lives here rather than in one app because every surface that renders or
 * forwards a stored blob needs the same word for it. Core's `~/lib/json-value`
 * re-exports these two and adds the zod decoders, which need a zod dependency
 * this package deliberately does not have.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

/**
 * A JSON object. Values admit `undefined` so a TypeScript object with optional
 * properties satisfies it — that is how an absent key is spelled on this side
 * of the boundary, and `JSON.stringify` drops it either way.
 */
export type JsonObject = { [key: string]: JsonValue | undefined };
