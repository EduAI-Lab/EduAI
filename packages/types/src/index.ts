// NOTE: Prisma dropped UserRole.TA in Core (the unify migration) — a course TA
// is now a STUDENT-platform user with an EnrollmentRole.TA enrollment. TA is
// kept on this shared platform UserRole only until the AI Tutor extension (which
// still models TA as a platform role across ~20 files) is migrated; removing it
// here breaks that build. Tracked as a follow-up (PR #685 review).
export type UserRole = 'ADMIN' | 'UNIT_ADMIN' | 'INSTRUCTOR' | 'TA' | 'STUDENT'

export type EnrollmentRole = 'INSTRUCTOR' | 'TA' | 'STUDENT'

// Runtime constants for JavaScript consumers (e.g. QM backend)
export const USER_ROLE_VALUES = [
  'ADMIN',
  'UNIT_ADMIN',
  'INSTRUCTOR',
  'TA',
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
}

export type SyncCanvasMaterialsResult = {
  imported: number
  updated: number
  skipped: number
  failed: Array<{ canvasFileId: string; message: string }>
}
