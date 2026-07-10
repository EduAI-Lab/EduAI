import { describe, it, expect } from 'vitest'
import { getNavForUser } from '~/lib/rbac/nav'
import type { NavGroupItem } from '~/lib/rbac/types'

describe('getNavForUser — ADMIN role', () => {
  it('wraps the 7 admin items into a NavGroupItem', () => {
    const result = getNavForUser({ role: 'ADMIN' })
    const group = result.find((item): item is NavGroupItem => 'children' in item)
    expect(group).toBeDefined()
    expect(group!.key).toBe('admin-group')
    expect(group!.title).toBe('Administration')
    expect(group!.children).toHaveLength(7)
  })

  it('includes all expected admin keys in the group children', () => {
    const result = getNavForUser({ role: 'ADMIN' })
    const group = result.find((item): item is NavGroupItem => 'children' in item)!
    const keys = group.children.map((c) => c.key)
    expect(keys).toEqual([
      'admin-users',
      'admin-ai',
      'admin-bugs',
      'admin-invites',
      'admin-settings',
      'admin-logs',
      'admin-cron',
    ])
  })

  it('returns no groups for INSTRUCTOR role', () => {
    const result = getNavForUser({ role: 'INSTRUCTOR' })
    expect(result.every((item) => !('children' in item))).toBe(true)
  })

  it('returns no groups for STUDENT role', () => {
    const result = getNavForUser({ role: 'STUDENT' })
    expect(result.every((item) => !('children' in item))).toBe(true)
  })

  it('returns no groups for UNIT_ADMIN role', () => {
    const result = getNavForUser({ role: 'UNIT_ADMIN' })
    expect(result.every((item) => !('children' in item))).toBe(true)
  })
})

describe('getNavForUser — core nav items', () => {
  it('always includes dashboard, courses, chat for ADMIN', () => {
    const result = getNavForUser({ role: 'ADMIN' })
    const keys = result.filter((item) => !('children' in item)).map((item) => item.key)
    expect(keys).toContain('dashboard')
    expect(keys).toContain('courses')
    expect(keys).toContain('chat')
  })
})
