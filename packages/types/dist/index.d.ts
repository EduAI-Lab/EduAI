export * from "./errors.js";
export type UserRole = "ADMIN" | "UNIT_ADMIN" | "INSTRUCTOR" | "STUDENT";
export type EnrollmentRole = "INSTRUCTOR" | "TA" | "STUDENT";
export declare const USER_ROLE_VALUES: readonly ["ADMIN", "UNIT_ADMIN", "INSTRUCTOR", "STUDENT"];
export declare const ENROLLMENT_ROLE_VALUES: readonly ["INSTRUCTOR", "TA", "STUDENT"];
/**
 * Prefer an explicit has* flag from the list API; otherwise treat a non-empty
 * string body as present. Shared so AI Tutor / QM enablement stays in lockstep.
 */
export declare function hasAttachmentContent(value: string | null | undefined, flag?: boolean | null): boolean;
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
    skippedItems: Array<{
        canvasFileId: string;
        reason: CanvasMaterialSkipReason;
    }>;
    failed: Array<{
        canvasFileId: string;
        message: string;
    }>;
};
export declare const MODEL_SIZE_RANK_PATTERNS: ReadonlyArray<readonly [RegExp, number]>;
/** Rank a model id/label string by parameter-size token (higher = larger). */
export declare function modelSizeRankFromText(text: string | null | undefined): number;
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
export type JsonObject = {
    [key: string]: JsonValue | undefined;
};
//# sourceMappingURL=index.d.ts.map