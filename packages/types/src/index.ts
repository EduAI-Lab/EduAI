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
