export type CourseAccess = 'admin' | 'unit' | 'instructor' | 'ta' | 'student' | null

export type UserRole = 'ADMIN' | 'UNIT_ADMIN' | 'PROFESSOR' | 'TA' | 'STUDENT'

export interface RbacUser {
  id: string
  role: UserRole
  authorizedUnits: string[]
}

export interface RbacCourse {
  id: string
  professorId: string
  department: string | null
}
