import { describe, it, expect } from 'vitest'
import { groupCoursesByTerm } from '~/lib/courses/term-grouping'

interface C { id: string; term: string; year: number }

const c = (id: string, term: string, year: number): C => ({ id, term, year })

describe('groupCoursesByTerm', () => {
  it('returns empty groups for an empty list', () => {
    expect(groupCoursesByTerm([])).toEqual({ current: [], previous: [] })
  })

  it('puts everything in current when all courses share one term', () => {
    const courses = [c('a', 'Fall', 2025), c('b', 'Fall', 2025)]
    const result = groupCoursesByTerm(courses)
    expect(result.current).toEqual(courses)
    expect(result.previous).toEqual([])
  })

  it('splits by year, latest year is current', () => {
    const a = c('a', 'Fall', 2024)
    const b = c('b', 'Fall', 2025)
    const result = groupCoursesByTerm([a, b])
    expect(result.current).toEqual([b])
    expect(result.previous).toEqual([a])
  })

  it('breaks ties within the same year using Winter < Spring < Summer < Fall', () => {
    const winter = c('w', 'Winter', 2025)
    const spring = c('sp', 'Spring', 2025)
    const summer = c('su', 'Summer', 2025)
    const fall = c('f', 'Fall', 2025)
    const result = groupCoursesByTerm([winter, spring, summer, fall])
    expect(result.current).toEqual([fall])
    expect(result.previous).toEqual([winter, spring, summer])
  })

  it('treats an unrecognized term as older than all known terms', () => {
    const known = c('k', 'Fall', 2025)
    const unknown = c('u', 'Mystery', 2025)
    const result = groupCoursesByTerm([known, unknown])
    expect(result.current).toEqual([known])
    expect(result.previous).toEqual([unknown])
  })
})
