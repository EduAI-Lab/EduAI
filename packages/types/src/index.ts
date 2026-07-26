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
