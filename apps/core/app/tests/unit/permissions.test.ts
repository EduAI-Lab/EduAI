import { describe, it, expect } from 'vitest'
import {
  canCreateCourse,
  canEditCourse,
  canPublishCourse,
  canDeleteCourse,
  canViewEnrollments,
  canManageStudents,
  canManageInstructors,
  canUploadMaterial,
  canViewMaterial,
  canDeleteMaterial,
  canRenameMaterial,
  canViewTopics,
  canManageTopics,
  isStudentAccess,
  courseChatViewPolicyKey,
  manageEnrollmentsPolicyKey,
  resolvePolicyGate,
} from '~/lib/rbac/permissions'
import type { CourseAccess, RbacUser } from '~/lib/rbac/types'

const ALL_ACCESS: CourseAccess[] = ['admin', 'unit', 'instructor', 'ta', 'student', null]

function makeUser(role: RbacUser['role'], authorizedUnits: string[] = []): RbacUser {
  return { id: 'u1', role, authorizedUnits }
}

// §5 Course Management
describe('canCreateCourse', () => {
  it.each([
    ['ADMIN', true],
    ['UNIT_ADMIN', true],
    ['INSTRUCTOR', false],
    // No platform TA role — a course TA is a STUDENT-platform user (covered below).
    ['STUDENT', false],
  ] as const)('role=%s → %s', (role, expected) => {
    expect(canCreateCourse(makeUser(role))).toBe(expected)
  })
})

describe('canEditCourse', () => {
  it.each([
    ['admin', true],
    ['unit', true],
    ['instructor', true],
    ['ta', false],
    ['student', false],
    [null, false],
  ] as [CourseAccess, boolean][])('access=%s → %s', (access, expected) => {
    expect(canEditCourse(access)).toBe(expected)
  })
})

describe('canPublishCourse', () => {
  it.each([
    ['admin', true],
    ['unit', true],
    ['instructor', true],
    ['ta', false],
    ['student', false],
    [null, false],
  ] as [CourseAccess, boolean][])('access=%s → %s', (access, expected) => {
    expect(canPublishCourse(access)).toBe(expected)
  })
})

describe('canDeleteCourse', () => {
  it.each([
    ['admin', true],
    ['unit', true],
    ['instructor', true],
    ['ta', false],
    ['student', false],
    [null, false],
  ] as [CourseAccess, boolean][])('access=%s → %s', (access, expected) => {
    expect(canDeleteCourse(access)).toBe(expected)
  })
})

// §6 Enrollment Management
describe('canViewEnrollments', () => {
  it.each([
    ['admin', true],
    ['unit', true],
    ['instructor', true],
    ['ta', true],
    ['student', false],
    [null, false],
  ] as [CourseAccess, boolean][])('access=%s → %s', (access, expected) => {
    expect(canViewEnrollments(access)).toBe(expected)
  })
})

describe('canManageStudents', () => {
  it.each([
    ['admin', true],
    ['unit', true],
    ['instructor', true],
    ['ta', false],
    ['student', false],
    [null, false],
  ] as [CourseAccess, boolean][])('access=%s → %s', (access, expected) => {
    expect(canManageStudents(access)).toBe(expected)
  })
})

describe('canManageInstructors', () => {
  it.each([
    ['admin', true],
    ['unit', true],
    ['instructor', false],
    ['ta', false],
    ['student', false],
    [null, false],
  ] as [CourseAccess, boolean][])('access=%s → %s', (access, expected) => {
    expect(canManageInstructors(access)).toBe(expected)
  })
})

// §7 Course Materials
describe('canUploadMaterial', () => {
  it.each([
    ['admin', true],
    ['unit', true],
    ['instructor', true],
    ['ta', true],
    ['student', false],
    [null, false],
  ] as [CourseAccess, boolean][])('access=%s → %s', (access, expected) => {
    expect(canUploadMaterial(access)).toBe(expected)
  })
})

describe('canViewMaterial — published course', () => {
  it.each(ALL_ACCESS)('access=%s → true (published)', (access) => {
    if (!access) {
      expect(canViewMaterial(access, true)).toBe(false)
    } else {
      expect(canViewMaterial(access, true)).toBe(true)
    }
  })
})

describe('canViewMaterial — unpublished course', () => {
  it.each([
    ['admin', true],
    ['unit', true],
    ['instructor', true],
    ['ta', true],
    ['student', false],
    [null, false],
  ] as [CourseAccess, boolean][])('access=%s → %s (unpublished)', (access, expected) => {
    expect(canViewMaterial(access, false)).toBe(expected)
  })
})

describe('canDeleteMaterial', () => {
  const ownerId = 'user-1'
  const otherId = 'user-2'

  it.each([
    ['admin', ownerId, otherId, true],
    ['unit', ownerId, otherId, true],
    ['instructor', ownerId, otherId, true],
    ['ta', ownerId, ownerId, true],    // own material
    ['ta', ownerId, otherId, false],   // other's material
    ['student', ownerId, ownerId, false],
    [null, ownerId, ownerId, false],
  ] as [CourseAccess, string, string, boolean][])('access=%s own=%s → %s', (access, userId, uploadedBy, expected) => {
    expect(canDeleteMaterial(access, userId, uploadedBy)).toBe(expected)
  })

  // #225 AUTH-08: uploadedBy is nullable (SetNull on uploader delete) — a null
  // uploader has no owner, so a TA must never match it even if their own
  // userId happens to be falsy-comparable. Non-TA staff are unaffected.
  it.each([
    ['admin', true],
    ['unit', true],
    ['instructor', true],
    ['ta', false],
    ['student', false],
  ] as [CourseAccess, boolean][])('access=%s with null uploadedBy (orphaned material) → %s', (access, expected) => {
    expect(canDeleteMaterial(access, ownerId, null)).toBe(expected)
  })
})

describe('canRenameMaterial', () => {
  const ownerId = 'user-1'
  const otherId = 'user-2'

  it.each([
    ['admin', ownerId, otherId, true],
    ['unit', ownerId, otherId, true],
    ['instructor', ownerId, otherId, true],
    ['ta', ownerId, ownerId, true],    // own material
    ['ta', ownerId, otherId, false],   // other's material
    ['student', ownerId, ownerId, false],
    [null, ownerId, ownerId, false],
  ] as [CourseAccess, string, string, boolean][])('access=%s own=%s → %s', (access, userId, uploadedBy, expected) => {
    expect(canRenameMaterial(access, userId, uploadedBy)).toBe(expected)
  })

  // #225 AUTH-08: same null-uploader fail-closed rule as canDeleteMaterial.
  it.each([
    ['admin', true],
    ['unit', true],
    ['instructor', true],
    ['ta', false],
    ['student', false],
  ] as [CourseAccess, boolean][])('access=%s with null uploadedBy (orphaned material) → %s', (access, expected) => {
    expect(canRenameMaterial(access, ownerId, null)).toBe(expected)
  })
})

// §8 Course Topics
describe('canViewTopics — published course', () => {
  it.each(ALL_ACCESS)('access=%s → correct (published)', (access) => {
    if (!access) {
      expect(canViewTopics(access, true)).toBe(false)
    } else {
      expect(canViewTopics(access, true)).toBe(true)
    }
  })
})

describe('canViewTopics — unpublished course', () => {
  it.each([
    ['admin', true],
    ['unit', true],
    ['instructor', true],
    ['ta', true],
    ['student', false],
    [null, false],
  ] as [CourseAccess, boolean][])('access=%s → %s (unpublished)', (access, expected) => {
    expect(canViewTopics(access, false)).toBe(expected)
  })
})

describe('canManageTopics', () => {
  it.each([
    ['admin', true],
    ['unit', true],
    ['instructor', true],
    ['ta', false],
    ['student', false],
    [null, false],
  ] as [CourseAccess, boolean][])('access=%s → %s', (access, expected) => {
    expect(canManageTopics(access)).toBe(expected)
  })
})

// §19 Cross-cutting
describe('isStudentAccess', () => {
  it.each([
    ['student', true],
    ['admin', false],
    ['unit', false],
    ['instructor', false],
    ['ta', false],
    [null, false],
  ] as [CourseAccess, boolean][])('access=%s → %s', (access, expected) => {
    expect(isStudentAccess(access)).toBe(expected)
  })
})

// §6 Enrollment & TA management gate
describe('manageEnrollmentsPolicyKey', () => {
  it.each([
    ['admin', 'always'],
    ['unit', 'always'],
    ['instructor', 'instructors.canManageEnrollments'],
    ['ta', 'never'],
    ['student', 'never'],
    [null, 'never'],
  ] as [CourseAccess, string][])('access=%s → %s', (access, expected) => {
    expect(manageEnrollmentsPolicyKey(access)).toBe(expected)
  })
})

// Central capability → gate resolver (single source of truth for routes/UI)
describe('resolvePolicyGate', () => {
  it('delegates viewChats to courseChatViewPolicyKey for every access level', () => {
    for (const access of ALL_ACCESS) {
      expect(resolvePolicyGate(access, 'viewChats')).toBe(courseChatViewPolicyKey(access))
    }
  })

  it('delegates manageEnrollments to manageEnrollmentsPolicyKey for every access level', () => {
    for (const access of ALL_ACCESS) {
      expect(resolvePolicyGate(access, 'manageEnrollments')).toBe(manageEnrollmentsPolicyKey(access))
    }
  })
})
