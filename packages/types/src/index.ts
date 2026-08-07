// Prisma dropped UserRole.TA in Core (the unify migration) — a course TA is a
// STUDENT-platform user with an EnrollmentRole.TA enrollment. Platform UserRole
// no longer includes TA (#225 AUTH-12); course-level TA stays on EnrollmentRole.
export type UserRole = 'ADMIN' | 'UNIT_ADMIN' | 'INSTRUCTOR' | 'STUDENT'

export type EnrollmentRole = 'INSTRUCTOR' | 'TA' | 'STUDENT'

// Runtime constants for JavaScript consumers (e.g. QM backend)
export const USER_ROLE_VALUES = [
  'ADMIN',
  'UNIT_ADMIN',
  'INSTRUCTOR',
  'STUDENT',
] as const satisfies readonly UserRole[]

export const ENROLLMENT_ROLE_VALUES = [
  'INSTRUCTOR',
  'TA',
  'STUDENT',
] as const satisfies readonly EnrollmentRole[]

/**
 * Prefer an explicit has* flag from the list API; otherwise treat a non-empty
 * string body as present. Shared so AI Tutor / QM enablement stays in lockstep.
 */
export function hasAttachmentContent(
  value: string | null | undefined,
  flag?: boolean | null,
): boolean {
  return Boolean(flag ?? (value != null && value !== ''))
}

// Canvas material sync
export type CanvasMaterialImportStatus = 'not_imported' | 'imported' | 'updated_on_canvas'

export type CanvasMaterialDiscoverItem = {
  canvasFileId: string
  displayName: string
  mimeType: string
  sizeBytes: number
  canvasUpdatedAt: string
  importStatus: CanvasMaterialImportStatus
  coreMaterialId: string | null
  isPublished: boolean
  isExcluded: boolean
}

export type CanvasMaterialSkipReason = 'unpublished' | 'excluded' | 'not-modified'

export type SyncCanvasMaterialsResult = {
  imported: number
  updated: number
  skipped: number
  skippedItems: Array<{ canvasFileId: string; reason: CanvasMaterialSkipReason }>
  failed: Array<{ canvasFileId: string; message: string }>
}

// Campus-model size ranking for QM pickers/probes. Shared here so the QM
// frontend doesn't need to reach into the QM backend's src/ to reuse it.
export const MODEL_SIZE_RANK_PATTERNS: ReadonlyArray<readonly [RegExp, number]> = Object.freeze([
  [/\b70b\b/, 70],
  [/\b32b\b/, 32],
  [/\b14b\b/, 14],
  [/\b7b\b/, 7],
  [/\b3b\b/, 3],
])

/** Rank a model id/label string by parameter-size token (higher = larger). */
export function modelSizeRankFromText(text: string | null | undefined): number {
  const lower = String(text ?? '').toLowerCase()
  for (const [pattern, rank] of MODEL_SIZE_RANK_PATTERNS) {
    if (pattern.test(lower)) return rank
  }
  return 0
}
