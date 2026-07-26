export type UserRole = 'ADMIN' | 'UNIT_ADMIN' | 'INSTRUCTOR' | 'TA' | 'STUDENT';
export type EnrollmentRole = 'INSTRUCTOR' | 'TA' | 'STUDENT';
export declare const USER_ROLE_VALUES: readonly ["ADMIN", "UNIT_ADMIN", "INSTRUCTOR", "TA", "STUDENT"];
export declare const ENROLLMENT_ROLE_VALUES: readonly ["INSTRUCTOR", "TA", "STUDENT"];
/**
 * Prefer an explicit has* flag from the list API; otherwise treat a non-empty
 * string body as present. Shared so AI Tutor / QM enablement stays in lockstep.
 */
export declare function hasAttachmentContent(value: string | null | undefined, flag?: boolean | null): boolean;
export type CanvasMaterialImportStatus = 'not_imported' | 'imported' | 'updated_on_canvas';
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
export type CanvasMaterialSkipReason = 'unpublished' | 'excluded' | 'not-modified';
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
//# sourceMappingURL=index.d.ts.map