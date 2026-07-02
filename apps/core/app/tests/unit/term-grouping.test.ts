import { describe, it, expect } from 'vitest'
import { groupCoursesByDate } from '~/lib/courses/term-grouping'

interface C { id: string; startDate: string; endDate: string | null }

const c = (id: string, startDate: string, endDate: string | null): C => ({ id, startDate, endDate })

describe('groupCoursesByDate', () => {
  it('returns empty groups for an empty list', () => {
    expect(groupCoursesByDate([], new Date('2026-07-02'))).toEqual({ previous: [], current: [], upcoming: [] })
  })

  it('puts a course in current when today is within its start/end range', () => {
    const course = c('a', '2026-06-01', '2026-08-31')
    const result = groupCoursesByDate([course], new Date('2026-07-15'))
    expect(result.current).toEqual([course])
    expect(result.previous).toEqual([])
    expect(result.upcoming).toEqual([])
  })

  it('puts a course in previous when today is after its end date', () => {
    const course = c('a', '2025-09-01', '2025-12-15')
    const result = groupCoursesByDate([course], new Date('2026-07-02'))
    expect(result.previous).toEqual([course])
    expect(result.current).toEqual([])
    expect(result.upcoming).toEqual([])
  })

  it('puts a course in upcoming when today is before its start date', () => {
    const course = c('a', '2026-09-01', '2026-12-15')
    const result = groupCoursesByDate([course], new Date('2026-07-02'))
    expect(result.upcoming).toEqual([course])
    expect(result.current).toEqual([])
    expect(result.previous).toEqual([])
  })

  it('treats a course with no end date as current indefinitely once started', () => {
    const course = c('a', '2025-01-01', null)
    const farFuture = groupCoursesByDate([course], new Date('2030-01-01'))
    expect(farFuture.current).toEqual([course])
    expect(farFuture.previous).toEqual([])
    const beforeStart = groupCoursesByDate([course], new Date('2024-06-01'))
    expect(beforeStart.upcoming).toEqual([course])
  })

  it('treats "today" exactly on the start date as current, not upcoming', () => {
    const course = c('a', '2026-07-02', '2026-08-01')
    const result = groupCoursesByDate([course], new Date('2026-07-02'))
    expect(result.current).toEqual([course])
    expect(result.upcoming).toEqual([])
  })

  it('treats "today" exactly on the end date as current, not previous', () => {
    const course = c('a', '2026-06-01', '2026-07-02')
    const result = groupCoursesByDate([course], new Date('2026-07-02'))
    expect(result.current).toEqual([course])
    expect(result.previous).toEqual([])
  })

  it('splits a mixed list into all three buckets independent of order', () => {
    const past = c('p', '2025-01-01', '2025-04-01')
    const now_ = c('n', '2026-06-01', '2026-08-01')
    const future = c('f', '2026-09-01', '2026-12-01')
    const result = groupCoursesByDate([future, past, now_], new Date('2026-07-02'))
    expect(result.previous).toEqual([past])
    expect(result.current).toEqual([now_])
    expect(result.upcoming).toEqual([future])
  })

  it('compares date-only start dates against a real-time `now` on UTC calendar days, not local wall-clock time', () => {
    // '2025-09-01' parses as 2025-09-01T00:00:00Z. A `now` of
    // 2025-08-31T20:00:00-07:00 is 2025-09-01T03:00:00Z: the same UTC
    // calendar day as the start date, so the course should already be
    // "current" (day-level equality), not "upcoming". Under a naive
    // instant-based (non-UTC-day-normalized) comparison this `now` instant
    // is still before the start instant, which would incorrectly classify
    // the course as upcoming.
    const course = c('a', '2025-09-01', '2025-12-15')
    const now = new Date('2025-08-31T20:00:00-07:00')
    const result = groupCoursesByDate([course], now)
    expect(result.current).toEqual([course])
    expect(result.upcoming).toEqual([])
    expect(result.previous).toEqual([])
  })

  it('defaults `now` to the real current date when not provided', () => {
    const result = groupCoursesByDate([c('x', '2020-01-01', null)])
    expect(result.previous.length + result.current.length + result.upcoming.length).toBe(1)
  })
})
