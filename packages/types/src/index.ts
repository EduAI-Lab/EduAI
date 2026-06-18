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
