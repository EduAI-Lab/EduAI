import { describe, it, expect } from 'vitest'
import { getNavForUser, getNavSecondaryForUser } from '~/lib/rbac/nav'

describe('nav — chatbot placement (#835)', () => {
  it('does not include chat in the main nav for STUDENT', () => {
    const nav = getNavForUser({ role: 'STUDENT' } as never)
    expect(nav.find((item) => item.key === 'chat')).toBeUndefined()
  })

  it('does not include chat in the main nav for ADMIN', () => {
    const nav = getNavForUser({ role: 'ADMIN' } as never)
    expect(nav.find((item) => item.key === 'chat')).toBeUndefined()
  })

  it('includes chat as the first secondary nav item for STUDENT', () => {
    const secondary = getNavSecondaryForUser({ role: 'STUDENT' } as never)
    expect(secondary[0]).toEqual({ key: 'chat', title: 'Course Chat', url: '/chat' })
  })

  it('includes chat as the first secondary nav item for ADMIN, ahead of Admin Chatbot', () => {
    const secondary = getNavSecondaryForUser({ role: 'ADMIN' } as never)
    expect(secondary[0].key).toBe('chat')
    expect(secondary.find((item) => item.key === 'admin-chat')).toBeDefined()
  })
})
