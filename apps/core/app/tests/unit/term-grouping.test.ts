import { describe, it, expect } from 'vitest'
import { groupCoursesByTerm } from '~/lib/courses/term-grouping'

interface C { id: string; term: string; year: number }

const c = (id: string, term: string, year: number): C => ({ id, term, year })

describe('groupCoursesByTerm', () => {
  it('returns empty groups for an empty list', () => {
    expect(groupCoursesByTerm([], new Date('2025-10-15'))).toEqual({ current: [], previous: [] })
  })

  it('puts a Fall course in current when today is in September-December of the same year', () => {
    const fall = c('a', 'Fall', 2025)
    const result = groupCoursesByTerm([fall], new Date('2025-10-15'))
    expect(result.current).toEqual([fall])
    expect(result.previous).toEqual([])
  })

  it('puts a Fall course in previous when today is a later year', () => {
    const fall = c('a', 'Fall', 2025)
    const result = groupCoursesByTerm([fall], new Date('2026-07-02'))
    expect(result.current).toEqual([])
    expect(result.previous).toEqual([fall])
  })

  it('treats Winter and Spring as the same current-term bucket (Jan-Apr)', () => {
    const winter = c('w', 'Winter', 2026)
    const spring = c('sp', 'Spring', 2026)
    const result = groupCoursesByTerm([winter, spring], new Date('2026-02-10'))
    expect(result.current).toEqual([winter, spring])
    expect(result.previous).toEqual([])
  })

  it('puts a Summer course in current only during May-August of the matching year', () => {
    const summer = c('su', 'Summer', 2026)
    const inRange = groupCoursesByTerm([summer], new Date('2026-06-01'))
    expect(inRange.current).toEqual([summer])
    const outOfRange = groupCoursesByTerm([summer], new Date('2026-09-15'))
    expect(outOfRange.current).toEqual([])
    expect(outOfRange.previous).toEqual([summer])
  })

  it('splits a mixed list into current and previous by real date, independent of course order', () => {
    const currentFall = c('cf', 'Fall', 2026)
    const oldFall = c('of', 'Fall', 2020)
    const oldWinter = c('ow', 'Winter', 2026)
    const result = groupCoursesByTerm([oldFall, currentFall, oldWinter], new Date('2026-10-01'))
    expect(result.current).toEqual([currentFall])
    expect(result.previous).toEqual([oldFall, oldWinter])
  })

  it('treats an unrecognized term as never current', () => {
    const unknown = c('u', 'Mystery', 2026)
    const result = groupCoursesByTerm([unknown], new Date('2026-10-01'))
    expect(result.current).toEqual([])
    expect(result.previous).toEqual([unknown])
  })

  it('defaults `now` to the real current date when not provided', () => {
    // Just confirm the function runs without a `now` argument and returns
    // both arrays (contents aren't asserted since "today" is not fixed here).
    const result = groupCoursesByTerm([c('x', 'Fall', 2025)])
    expect(result.current.length + result.previous.length).toBe(1)
  })
})
