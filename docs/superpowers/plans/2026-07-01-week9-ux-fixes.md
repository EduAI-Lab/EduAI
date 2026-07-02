# Week 9 UX Fixes Implementation Plan (#832, #833, #834, #835)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four independent Core-app UX fixes in one PR: TA/student course-list separation, current-vs-previous term grouping, "Department" → "Course Subject" copy rename, and moving the Chatbot nav link to the bottom of the sidebar.

**Architecture:** All changes live in `apps/core`. A new pure helper (`groupCoursesByTerm`) and a new component (`CoursesMixedView`) replace two existing components (`CoursesTaView`, `CoursesStudentView`); everything else is targeted edits to existing files (label text, nav data ordering).

**Tech Stack:** React Router v7, Vitest + Testing Library (happy-dom), TypeScript, Tailwind, `@eduai/ui` component library.

## Global Constraints

- Run all tests from `apps/core`: `cd apps/core && npx vitest run <path>`.
- No changes to the `department` DB column, Prisma schema, Zod schemas, or any API/hook field names (`Course.department`, `CreateCourseInput.department`, etc.) — rename is UI copy only.
- No changes to Admin or UnitAdmin course views' role branching or term/role grouping — only Instructor/TA/Student surfaces get term grouping.
- Update `TESTS.md` for every test file added, removed, or whose description changes.
- Component filenames use kebab-case; exported component names use PascalCase (existing repo convention).

---

### Task 1: `groupCoursesByTerm` helper

**Files:**
- Create: `apps/core/app/lib/courses/term-grouping.ts`
- Test: `apps/core/app/tests/unit/term-grouping.test.ts`

**Interfaces:**
- Produces: `groupCoursesByTerm<T extends { term: string; year: number }>(courses: T[]): { current: T[]; previous: T[] }` — used by Task 3.

- [ ] **Step 1: Write the failing test**

```ts
// apps/core/app/tests/unit/term-grouping.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/core && npx vitest run app/tests/unit/term-grouping.test.ts`
Expected: FAIL — `Failed to resolve import "~/lib/courses/term-grouping"`

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/core/app/lib/courses/term-grouping.ts
const TERM_ORDER = ['Winter', 'Spring', 'Summer', 'Fall'] as const

function termRank(term: string): number {
  const index = TERM_ORDER.indexOf(term as (typeof TERM_ORDER)[number])
  return index === -1 ? -1 : index
}

/**
 * Splits courses into the latest (year, term) group present in the list
 * ("current") and everything else ("previous"). Ties within the same year
 * are broken using TERM_ORDER (Winter < Spring < Summer < Fall).
 */
export function groupCoursesByTerm<T extends { term: string; year: number }>(
  courses: T[],
): { current: T[]; previous: T[] } {
  if (courses.length === 0) return { current: [], previous: [] }

  let latestYear = -Infinity
  let latestRank = -Infinity
  for (const course of courses) {
    const rank = termRank(course.term)
    if (
      course.year > latestYear ||
      (course.year === latestYear && rank > latestRank)
    ) {
      latestYear = course.year
      latestRank = rank
    }
  }

  const current: T[] = []
  const previous: T[] = []
  for (const course of courses) {
    if (course.year === latestYear && termRank(course.term) === latestRank) {
      current.push(course)
    } else {
      previous.push(course)
    }
  }
  return { current, previous }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/core && npx vitest run app/tests/unit/term-grouping.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Add to TESTS.md**

Insert an alphabetically-ordered row near other `term`/`course` entries in `TESTS.md`:

```
| [`term-grouping.test.ts`](apps/core/app/tests/unit/term-grouping.test.ts) | Verifies `groupCoursesByTerm` splits courses into the latest (year, term) group ("current") vs everything else ("previous"), covering empty input, single-term lists, cross-year splits, same-year term tie-breaking (Winter < Spring < Summer < Fall), and unrecognized term strings. |
```

- [ ] **Step 6: Commit**

```bash
cd apps/core && git add app/lib/courses/term-grouping.ts app/tests/unit/term-grouping.test.ts && git -C .. add TESTS.md
git commit -m "feat(core): add groupCoursesByTerm helper for current/previous term split"
```

---

### Task 2: `CoursesMixedView` replaces `CoursesTaView` + `CoursesStudentView`

**Files:**
- Create: `apps/core/app/components/courses/courses-mixed-view.tsx`
- Modify: `apps/core/app/routes/courses.tsx:1-154` (imports + render branch)
- Modify: `apps/core/app/tests/unit/CoursesList.test.tsx:1-9,262-293` (replace TA/Student describe blocks)
- Delete: `apps/core/app/components/courses/courses-ta-view.tsx`
- Delete: `apps/core/app/components/courses/courses-student-view.tsx`
- Modify: `TESTS.md` (update the `CoursesList.test.tsx` row description)

**Interfaces:**
- Produces: `CoursesMixedView({ courses, taCourseIds, enrolledCourseIds }: { courses: Course[]; taCourseIds: string[]; enrolledCourseIds: string[] })` — a default-exportable named export, used by `courses.tsx`. `Course` type is `~/hooks/api/use-courses`'s existing `Course` interface.

- [ ] **Step 1: Write the failing tests (replace the TA/Student describe blocks)**

In `apps/core/app/tests/unit/CoursesList.test.tsx`, replace the import on line 7-8:

```ts
import { CoursesTaView } from '~/components/courses/courses-ta-view'
import { CoursesStudentView } from '~/components/courses/courses-student-view'
```

with:

```ts
import { CoursesMixedView } from '~/components/courses/courses-mixed-view'
```

Then replace the two describe blocks at lines 262-293 (`describe('CoursesTaView', ...)` and `describe('CoursesStudentView', ...)`) with:

```ts
// CoursesMixedView
describe('CoursesMixedView', () => {
  const TA_COURSE: Course = { ...PUBLISHED_COURSE, id: 'ta1', code: 'COSC 301', name: 'TA Course' }
  const STUDENT_COURSE: Course = { ...PUBLISHED_COURSE, id: 'stu1', code: 'COSC 401', name: 'Student Course' }

  it('does NOT show "Create Course" button', () => {
    wrap(
      <CoursesMixedView
        courses={[TA_COURSE]}
        taCourseIds={['ta1']}
        enrolledCourseIds={[]}
      />
    )
    expect(screen.queryByRole('button', { name: /create course/i })).not.toBeInTheDocument()
  })

  it('shows only the "assisting" section when the user has TA courses only', () => {
    wrap(
      <CoursesMixedView
        courses={[TA_COURSE]}
        taCourseIds={['ta1']}
        enrolledCourseIds={[]}
      />
    )
    expect(screen.getByText(/assisting/i)).toBeInTheDocument()
    expect(screen.getByText('COSC 301')).toBeInTheDocument()
    expect(screen.queryByText(/enrolled/i)).not.toBeInTheDocument()
  })

  it('shows only the "enrolled" section when the user has student courses only', () => {
    wrap(
      <CoursesMixedView
        courses={[STUDENT_COURSE]}
        taCourseIds={[]}
        enrolledCourseIds={['stu1']}
      />
    )
    expect(screen.getByText(/enrolled/i)).toBeInTheDocument()
    expect(screen.getByText('COSC 401')).toBeInTheDocument()
    expect(screen.queryByText(/assisting/i)).not.toBeInTheDocument()
  })

  it('shows both sections when the user has both TA and student courses', () => {
    wrap(
      <CoursesMixedView
        courses={[TA_COURSE, STUDENT_COURSE]}
        taCourseIds={['ta1']}
        enrolledCourseIds={['stu1']}
      />
    )
    expect(screen.getByText(/assisting/i)).toBeInTheDocument()
    expect(screen.getByText(/enrolled/i)).toBeInTheDocument()
    expect(screen.getByText('COSC 301')).toBeInTheDocument()
    expect(screen.getByText('COSC 401')).toBeInTheDocument()
  })

  it('hides draft (unpublished) courses from the enrolled section', () => {
    wrap(
      <CoursesMixedView
        courses={[STUDENT_COURSE, { ...STUDENT_COURSE, id: 'stu2', code: 'COSC 402', isPublished: false }]}
        taCourseIds={[]}
        enrolledCourseIds={['stu1', 'stu2']}
      />
    )
    expect(screen.getByText('COSC 401')).toBeInTheDocument()
    expect(screen.queryByText('COSC 402')).not.toBeInTheDocument()
  })

  it('shows empty state when the user has neither TA nor enrolled courses', () => {
    wrap(<CoursesMixedView courses={[]} taCourseIds={[]} enrolledCourseIds={[]} />)
    expect(screen.getByText(/no courses/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/core && npx vitest run app/tests/unit/CoursesList.test.tsx`
Expected: FAIL — `Failed to resolve import "~/components/courses/courses-mixed-view"`

- [ ] **Step 3: Write the component**

```tsx
// apps/core/app/components/courses/courses-mixed-view.tsx
import { Link } from 'react-router'
import { IconBook } from '@tabler/icons-react'
import { Card, CardContent, CourseCard, PageHeading } from '@eduai/ui'
import type { Course } from '~/hooks/api/use-courses'

interface Props {
  courses: Course[]
  taCourseIds: string[]
  enrolledCourseIds: string[]
}

function CourseGrid({ courses }: { courses: Course[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {courses.map((course, index) => (
        <CourseCard
          key={course.id}
          id={course.id}
          code={course.code}
          name={course.name}
          description={course.description}
          term={course.term}
          year={course.year}
          isPublished={course.isPublished}
          department={course.department}
          colorIndex={index}
          href={`/courses/${course.id}`}
          LinkComponent={Link}
        />
      ))}
    </div>
  )
}

export function CoursesMixedView({ courses, taCourseIds, enrolledCourseIds }: Props) {
  const assisting = courses.filter((c) => taCourseIds.includes(c.id))
  const enrolled = courses.filter(
    (c) => enrolledCourseIds.includes(c.id) && c.isPublished,
  )

  if (assisting.length === 0 && enrolled.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeading heading="My Courses" subheading="Your courses" />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">You have no courses yet.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {assisting.length > 0 && (
        <div className="flex flex-col gap-4">
          <PageHeading heading="Courses You Are Assisting In" subheading="Courses where you are a TA" />
          <CourseGrid courses={assisting} />
        </div>
      )}
      {enrolled.length > 0 && (
        <div className="flex flex-col gap-4">
          <PageHeading heading="Courses You Are Enrolled In" subheading="Your enrolled courses" />
          <CourseGrid courses={enrolled} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire into `courses.tsx`**

In `apps/core/app/routes/courses.tsx`, replace the imports on lines 12-13:

```ts
import { CoursesTaView } from '~/components/courses/courses-ta-view'
import { CoursesStudentView } from '~/components/courses/courses-student-view'
```

with:

```ts
import { CoursesMixedView } from '~/components/courses/courses-mixed-view'
```

Replace the render branch on lines 140-150:

```tsx
        ) : isTA ? (
          <CoursesTaView
            courses={courses.filter((c) => taCourseIds.includes(c.id))}
          />
        ) : (
          <CoursesStudentView
            courses={courses.filter(
              (c) => enrolledCourseIds.includes(c.id) && c.isPublished,
            )}
          />
        )}
```

with:

```tsx
        ) : (
          <CoursesMixedView
            courses={courses}
            taCourseIds={taCourseIds}
            enrolledCourseIds={enrolledCourseIds}
          />
        )}
```

The `isTA` variable declared at line 77 (`const isTA = taCourseIds.length > 0`) is now unused by this branch — remove that line since it has no other reader in the file (confirm with a search before deleting; if any other line reads `isTA`, keep it).

- [ ] **Step 5: Delete the superseded components**

```bash
rm apps/core/app/components/courses/courses-ta-view.tsx
rm apps/core/app/components/courses/courses-student-view.tsx
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/core && npx vitest run app/tests/unit/CoursesList.test.tsx`
Expected: PASS (all `CoursesMixedView` cases plus unaffected Admin/UnitAdmin/Instructor blocks)

Run: `cd apps/core && npm run typecheck` to confirm no other file imports the deleted components.
Expected: no errors referencing `courses-ta-view` or `courses-student-view`.

- [ ] **Step 7: Update TESTS.md**

Update the `CoursesList.test.tsx` row (around line 252) to:

```
| [`CoursesList.test.tsx`](apps/core/app/tests/unit/CoursesList.test.tsx) | Verifies Admin, UnitAdmin, and Instructor course list views render course cards correctly (published/draft, empty states), and that `CoursesMixedView` renders separate "Courses You Are Assisting In" / "Courses You Are Enrolled In" sections — each only shown when the user has courses in that role, both shown together for dual-role users, and a combined empty state when neither applies. |
```

- [ ] **Step 8: Commit**

```bash
git add apps/core/app/components/courses/courses-mixed-view.tsx apps/core/app/routes/courses.tsx apps/core/app/tests/unit/CoursesList.test.tsx TESTS.md
git rm apps/core/app/components/courses/courses-ta-view.tsx apps/core/app/components/courses/courses-student-view.tsx
git commit -m "fix(core): show both TA and student course sections for dual-role users (#832)"
```

---

### Task 3: Apply current/previous term grouping to Instructor, TA, and Student sections

**Files:**
- Modify: `apps/core/app/components/courses/courses-mixed-view.tsx` (from Task 2)
- Modify: `apps/core/app/components/courses/courses-instructor-view.tsx:203-232`
- Modify: `apps/core/app/tests/unit/CoursesList.test.tsx` (add term-grouping cases)
- Modify: `TESTS.md`

**Interfaces:**
- Consumes: `groupCoursesByTerm` from Task 1 (`~/lib/courses/term-grouping`).

- [ ] **Step 1: Write the failing tests**

Add to `apps/core/app/tests/unit/CoursesList.test.tsx`, inside the `describe('CoursesMixedView', ...)` block from Task 2:

```ts
  it('groups older-term courses under "Previous Terms" in the assisting section', () => {
    const oldTa = { ...TA_COURSE, id: 'ta-old', code: 'COSC 300', year: 2020 }
    wrap(
      <CoursesMixedView
        courses={[TA_COURSE, oldTa]}
        taCourseIds={['ta1', 'ta-old']}
        enrolledCourseIds={[]}
      />
    )
    expect(screen.getByText('COSC 301')).toBeInTheDocument()
    expect(screen.getByText(/previous terms/i)).toBeInTheDocument()
    expect(screen.getByText('COSC 300')).toBeInTheDocument()
  })

  it('does not show a "Previous Terms" heading when all courses share one term', () => {
    wrap(
      <CoursesMixedView
        courses={[TA_COURSE]}
        taCourseIds={['ta1']}
        enrolledCourseIds={[]}
      />
    )
    expect(screen.queryByText(/previous terms/i)).not.toBeInTheDocument()
  })
```

And to the `describe('CoursesInstructorView', ...)` block:

```ts
  it('groups older-term courses under "Previous Terms"', () => {
    const oldCourse = { ...PUBLISHED_COURSE, id: 'old1', code: 'COSC 999', year: 2020 }
    wrap(
      <CoursesInstructorView
        courses={[PUBLISHED_COURSE, oldCourse]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    expect(screen.getByText('COSC 101')).toBeInTheDocument()
    expect(screen.getByText(/previous terms/i)).toBeInTheDocument()
    expect(screen.getByText('COSC 999')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/core && npx vitest run app/tests/unit/CoursesList.test.tsx`
Expected: FAIL — "Previous Terms" text not found (both new assertions).

- [ ] **Step 3: Implement in `CoursesMixedView`**

Replace the `CourseGrid`-only rendering in `apps/core/app/components/courses/courses-mixed-view.tsx` with a `TermGroupedGrid` helper and use it for both sections:

```tsx
import { Link } from 'react-router'
import { IconBook } from '@tabler/icons-react'
import { Card, CardContent, CourseCard, PageHeading } from '@eduai/ui'
import type { Course } from '~/hooks/api/use-courses'
import { groupCoursesByTerm } from '~/lib/courses/term-grouping'

interface Props {
  courses: Course[]
  taCourseIds: string[]
  enrolledCourseIds: string[]
}

function CourseGrid({ courses }: { courses: Course[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {courses.map((course, index) => (
        <CourseCard
          key={course.id}
          id={course.id}
          code={course.code}
          name={course.name}
          description={course.description}
          term={course.term}
          year={course.year}
          isPublished={course.isPublished}
          department={course.department}
          colorIndex={index}
          href={`/courses/${course.id}`}
          LinkComponent={Link}
        />
      ))}
    </div>
  )
}

function TermGroupedGrid({ courses }: { courses: Course[] }) {
  const { current, previous } = groupCoursesByTerm(courses)
  return (
    <div className="flex flex-col gap-4">
      <CourseGrid courses={current} />
      {previous.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Previous Terms</h3>
          <CourseGrid courses={previous} />
        </div>
      )}
    </div>
  )
}

export function CoursesMixedView({ courses, taCourseIds, enrolledCourseIds }: Props) {
  const assisting = courses.filter((c) => taCourseIds.includes(c.id))
  const enrolled = courses.filter(
    (c) => enrolledCourseIds.includes(c.id) && c.isPublished,
  )

  if (assisting.length === 0 && enrolled.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeading heading="My Courses" subheading="Your courses" />
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <IconBook className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">You have no courses yet.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {assisting.length > 0 && (
        <div className="flex flex-col gap-4">
          <PageHeading heading="Courses You Are Assisting In" subheading="Courses where you are a TA" />
          <TermGroupedGrid courses={assisting} />
        </div>
      )}
      {enrolled.length > 0 && (
        <div className="flex flex-col gap-4">
          <PageHeading heading="Courses You Are Enrolled In" subheading="Your enrolled courses" />
          <TermGroupedGrid courses={enrolled} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Implement in `CoursesInstructorView`**

In `apps/core/app/components/courses/courses-instructor-view.tsx`, add the import near the top (after line 29's `usePolicies` import):

```ts
import { groupCoursesByTerm } from '~/lib/courses/term-grouping'
```

Replace the course-grid block (lines 202-232, the `{courses.length === 0 ? ... : (<div className="grid gap-4 ...">...)}`) — keep the empty-state branch as-is, but replace the non-empty branch's inner grid with:

```tsx
      ) : (
        <div className="flex flex-col gap-4">
          {(() => {
            const { current, previous } = groupCoursesByTerm(courses)
            const renderGrid = (list: typeof courses) => (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {list.map((course, index) => (
                  <CourseCard
                    key={course.id}
                    id={course.id}
                    code={course.code}
                    name={course.name}
                    description={course.description}
                    term={course.term}
                    year={course.year}
                    isPublished={course.isPublished}
                    department={course.department}
                    colorIndex={index}
                    href={`/courses/${course.id}`}
                    LinkComponent={Link}
                    actions={{
                      showPublish: canPublish,
                      isPublished: course.isPublished,
                      onPublishToggle: () => onPublishToggle(course.id, !course.isPublished),
                      showEdit: true,
                      onEdit: () => setTimeout(() => setEditingCourse(course), 0),
                      showDelete: canDelete,
                      onDelete: () => setTimeout(() => setDeletingCourse(course), 0),
                    }}
                  />
                ))}
              </div>
            )
            return (
              <>
                {renderGrid(current)}
                {previous.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-muted-foreground">Previous Terms</h3>
                    {renderGrid(previous)}
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/core && npx vitest run app/tests/unit/CoursesList.test.tsx`
Expected: PASS (all cases, including the two new "Previous Terms" assertions).

- [ ] **Step 6: Update TESTS.md**

Amend the `CoursesList.test.tsx` description (same row as Task 2) to append term-grouping coverage:

```
| [`CoursesList.test.tsx`](apps/core/app/tests/unit/CoursesList.test.tsx) | Verifies Admin, UnitAdmin, and Instructor course list views render course cards correctly (published/draft, empty states), that Instructor/TA/Student grids group older-term courses under a "Previous Terms" heading via `groupCoursesByTerm`, and that `CoursesMixedView` renders separate "Courses You Are Assisting In" / "Courses You Are Enrolled In" sections — each only shown when the user has courses in that role, both shown together for dual-role users, and a combined empty state when neither applies. |
```

- [ ] **Step 7: Commit**

```bash
git add apps/core/app/components/courses/courses-mixed-view.tsx apps/core/app/components/courses/courses-instructor-view.tsx apps/core/app/tests/unit/CoursesList.test.tsx TESTS.md
git commit -m "feat(core): group current vs previous term courses in TA/student/instructor lists (#833)"
```

---

### Task 4: Rename "Department" UI copy to "Course Subject"

**Files:**
- Modify: `apps/core/app/components/courses/department-combobox.tsx:16-44`
- Modify: `apps/core/app/components/courses/courses-instructor-view.tsx:123`
- Modify: `apps/core/app/components/courses/courses-admin-view.tsx:120,277,282`
- Modify: `apps/core/app/components/courses/courses-unit-admin-view.tsx:138,147,163,328,333`
- Modify: `apps/core/app/components/courses/course-detail-student-view.tsx:122`
- Modify: `apps/core/app/components/courses/course-detail-ta-view.tsx:391`
- Modify: `apps/core/app/components/courses/course-detail-manager-view.tsx:688`
- Modify: `apps/core/app/components/admin/user-form-dialog.tsx:166,168`
- Test: `apps/core/app/tests/unit/CoursesList.test.tsx` (label assertion)
- Modify: `TESTS.md`

**Interfaces:** None — pure copy edits, no signature changes.

- [ ] **Step 1: Write the failing test**

Add a new test inside `describe('CoursesInstructorView', ...)` in `apps/core/app/tests/unit/CoursesList.test.tsx`:

```ts
  it('labels the department field as "Course Subject"', () => {
    wrap(
      <CoursesInstructorView
        courses={[PUBLISHED_COURSE]}
        onCreateCourse={NOOP}
        onEditCourse={NOOP}
        onDeleteCourse={NOOP}
        onPublishToggle={NOOP}
      />
    )
    // The label is only in the DOM once the create dialog is open, but the
    // Radix Dialog trigger renders the label in a hidden DialogContent by
    // default in this component; assert directly that "Department" text is
    // gone from the rendered create-form markup.
    expect(screen.queryByText('Department')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/core && npx vitest run app/tests/unit/CoursesList.test.tsx -t "Course Subject"`
Expected: FAIL — `queryByText('Department')` finds a match (the `<Label>Department</Label>` in the create dialog markup, which Radix renders even when the dialog is visually closed in jsdom/happy-dom).

- [ ] **Step 3: Apply the copy changes**

`apps/core/app/components/courses/department-combobox.tsx` — update the default placeholder and static strings:

```tsx
export function DepartmentCombobox({
  departments,
  value,
  onValueChange,
  disabled,
  placeholder = 'Select course subject',
}: DepartmentComboboxProps) {
  const options: ComboboxOption[] = departments.map((d) => ({
    value: d.code,
    label: d.label,
    description: `(${d.code})`,
  }))

  return (
    <Combobox
      options={options}
      value={value || null}
      onValueChange={(selectedValue) => {
        if (selectedValue !== null) {
          onValueChange(selectedValue)
        }
      }}
      placeholder={placeholder}
      searchPlaceholder="Search course subjects..."
      emptyText="No course subject found."
      disabled={disabled}
    />
  )
}
```

`apps/core/app/components/courses/courses-instructor-view.tsx:123`:

```tsx
                  <Label htmlFor="ins-dept">Course Subject</Label>
```

`apps/core/app/components/courses/courses-admin-view.tsx:120`:

```tsx
                <Label htmlFor="create-dept">Course Subject</Label>
```

`apps/core/app/components/courses/courses-admin-view.tsx:277`:

```tsx
                <Label>Course Subject</Label>
```

`apps/core/app/components/courses/courses-admin-view.tsx:282`:

```tsx
                  placeholder="No course subject"
```

`apps/core/app/components/courses/courses-unit-admin-view.tsx:138`:

```tsx
                New courses will be assigned to one of your authorized course subjects.
```

`apps/core/app/components/courses/courses-unit-admin-view.tsx:147`:

```tsx
                <Label htmlFor="ua-dept">Course Subject</Label>
```

`apps/core/app/components/courses/courses-unit-admin-view.tsx:163`:

```tsx
                    placeholder="Select course subject"
```

`apps/core/app/components/courses/courses-unit-admin-view.tsx:328`:

```tsx
                <Label>Course Subject</Label>
```

`apps/core/app/components/courses/courses-unit-admin-view.tsx:333`:

```tsx
                  placeholder="No course subject"
```

`apps/core/app/components/courses/course-detail-student-view.tsx:122`:

```tsx
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Course Subject</p>
```

`apps/core/app/components/courses/course-detail-ta-view.tsx:391`:

```tsx
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">Course Subject</p>
```

`apps/core/app/components/courses/course-detail-manager-view.tsx:688`:

```tsx
                        Course Subject
```

`apps/core/app/components/admin/user-form-dialog.tsx:166,168`:

```tsx
                <FormLabel>Authorized Course Subjects</FormLabel>
                <FormDescription>
                  Select the course subjects this administrator can manage.
                </FormDescription>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/core && npx vitest run app/tests/unit/CoursesList.test.tsx`
Expected: PASS (full file, including the new "Course Subject" test).

- [ ] **Step 5: Search for any missed "Department" UI copy**

Run: `cd apps/core && grep -rn "Department" app/components app/routes --include="*.tsx" | grep -v "DepartmentCombobox\|Departments this\|interface Department"`

Confirm the only remaining matches are import statements / type names (`DepartmentCombobox`, `Department` interface) — not visible copy. If any visible-copy match remains, apply the same "Course Subject" substitution and re-run Step 4.

- [ ] **Step 6: Update TESTS.md**

Amend the `CoursesList.test.tsx` row again to note the label coverage:

```
| [`CoursesList.test.tsx`](apps/core/app/tests/unit/CoursesList.test.tsx) | Verifies Admin, UnitAdmin, and Instructor course list views render course cards correctly (published/draft, empty states) with the course-subject field labeled "Course Subject" (not "Department"), that Instructor/TA/Student grids group older-term courses under a "Previous Terms" heading via `groupCoursesByTerm`, and that `CoursesMixedView` renders separate "Courses You Are Assisting In" / "Courses You Are Enrolled In" sections — each only shown when the user has courses in that role, both shown together for dual-role users, and a combined empty state when neither applies. |
```

- [ ] **Step 7: Commit**

```bash
git add apps/core/app/components/courses/department-combobox.tsx \
  apps/core/app/components/courses/courses-instructor-view.tsx \
  apps/core/app/components/courses/courses-admin-view.tsx \
  apps/core/app/components/courses/courses-unit-admin-view.tsx \
  apps/core/app/components/courses/course-detail-student-view.tsx \
  apps/core/app/components/courses/course-detail-ta-view.tsx \
  apps/core/app/components/courses/course-detail-manager-view.tsx \
  apps/core/app/components/admin/user-form-dialog.tsx \
  apps/core/app/tests/unit/CoursesList.test.tsx TESTS.md
git commit -m "refactor(core): rename \"Department\" UI copy to \"Course Subject\" (#834)"
```

---

### Task 5: Move "Chatbot" nav link to the bottom of the sidebar

**Files:**
- Modify: `apps/core/app/lib/rbac/nav.ts:5-9,80-96`
- Create: `apps/core/app/tests/unit/nav.test.ts`
- Modify: `TESTS.md`

**Interfaces:**
- `getNavForUser(user, opts)` no longer includes the `chat` key.
- `getNavSecondaryForUser(user)` now includes `{ key: 'chat', title: 'Chatbot', url: '/chat' }` as its first entry for every role.

`AppSidebar.test.tsx` is unchanged: its existing assertions only check link presence/attributes, not main-vs-secondary grouping, so they remain valid before and after this change. The nav-placement guarantee is tested directly against `nav.ts`'s functions instead of through rendered DOM, since that's the authoritative source and avoids coupling the test to `@eduai/ui`'s internal sidebar markup.

- [ ] **Step 1: Write the failing test**

Create `apps/core/app/tests/unit/nav.test.ts`:

```ts
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
    expect(secondary[0]).toEqual({ key: 'chat', title: 'Chatbot', url: '/chat' })
  })

  it('includes chat as the first secondary nav item for ADMIN, ahead of Admin Chatbot', () => {
    const secondary = getNavSecondaryForUser({ role: 'ADMIN' } as never)
    expect(secondary[0].key).toBe('chat')
    expect(secondary.find((item) => item.key === 'admin-chat')).toBeDefined()
  })
})
```

Run: `cd apps/core && npx vitest run app/tests/unit/nav.test.ts`
Expected: FAIL — `getNavForUser({ role: 'STUDENT' })` still includes `chat`; `getNavSecondaryForUser(...)[0]` is not the chat item.

- [ ] **Step 2: Implement the nav.ts change**

In `apps/core/app/lib/rbac/nav.ts`, replace lines 5-9:

```ts
const CORE_NAV: NavItem[] = [
  { key: 'dashboard', title: 'Dashboard', url: '/dashboard' },
  { key: 'courses', title: 'Courses', url: '/courses' },
  { key: 'chat', title: 'Chatbot', url: '/chat' },
]
```

with:

```ts
const CORE_NAV: NavItem[] = [
  { key: 'dashboard', title: 'Dashboard', url: '/dashboard' },
  { key: 'courses', title: 'Courses', url: '/courses' },
]

const CHATBOT_NAV_ITEM: NavItem = { key: 'chat', title: 'Chatbot', url: '/chat' }
```

Replace the `getNavSecondaryForUser` function (lines 80-96):

```ts
/** Secondary sidebar links (bottom of sidebar). */
export function getNavSecondaryForUser(user: NavUser): NavItem[] {
  const role = user.role ?? 'STUDENT'
  const items: NavItem[] = [CHATBOT_NAV_ITEM]

  if (role === 'ADMIN') {
    items.push(...ADMIN_SECONDARY_NAV)
  }

  if (QM_NAV_ROLES.has(role)) {
    items.push(QM_NAV_ITEM)
  }

  items.push(AI_TUTOR_NAV_ITEM)

  return items
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd apps/core && npx vitest run app/tests/unit/nav.test.ts app/tests/unit/AppSidebar.test.tsx`
Expected: PASS (all `nav.test.ts` cases; `AppSidebar.test.tsx`'s existing cases still pass since they only assert presence/attributes, not grouping).

- [ ] **Step 4: Run the full Core unit suite to catch any other nav-order dependent test**

Run: `cd apps/core && npm run test:unit`
Expected: PASS. If any other test asserts on `getNavForUser`/`getNavSecondaryForUser` array shape (search first: `grep -rn "getNavForUser\|getNavSecondaryForUser" apps/core/app/tests`), update it the same way as `nav.test.ts`.

- [ ] **Step 5: Update TESTS.md**

Add a new row (alphabetically near other `nav`/`n`-prefixed entries):

```
| [`nav.test.ts`](apps/core/app/tests/unit/nav.test.ts) | Verifies `getNavForUser` no longer includes the Chatbot link in the main nav, and `getNavSecondaryForUser` returns it as the first bottom-nav item for every role, ahead of Admin Chatbot/Question Maker/AI Tutor (#835). |
```

- [ ] **Step 6: Commit**

```bash
git add apps/core/app/lib/rbac/nav.ts apps/core/app/tests/unit/nav.test.ts TESTS.md
git commit -m "feat(core): move Chatbot nav link to the bottom sidebar group (#835)"
```

---

### Task 6: Full verification pass

**Files:** None created/modified — verification only.

- [ ] **Step 1: Run the full Core unit suite**

Run: `cd apps/core && npm run test:unit`
Expected: all suites PASS, no leftover references to `courses-ta-view` / `courses-student-view`.

- [ ] **Step 2: Run typecheck**

Run: `cd apps/core && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint` (from repo root, or `cd apps/core && npx eslint .` if the root script is slow to scope)
Expected: no new errors in changed files.

- [ ] **Step 4: Manual smoke check of routes.ts / other consumers**

Run: `cd apps/core && grep -rn "CoursesTaView\|CoursesStudentView" app/`
Expected: no matches (confirms Task 2's deletion was complete and nothing else imported the removed components).

- [ ] **Step 5: Final commit if any fixups were needed**

```bash
git add -A
git commit -m "chore(core): fix lint/typecheck fallout from week 9 UX fixes"
```

(Skip this commit if Steps 1-4 required no changes.)
