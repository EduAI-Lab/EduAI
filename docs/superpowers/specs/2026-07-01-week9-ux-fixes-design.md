# Week 9 UX Fixes — Issues #832, #833, #834, #835

## Summary

Four small, independent frontend UX fixes bundled into one PR, all scoped to `apps/core`:

1. **#832** — Clear separation between TA-assisted and student-enrolled courses on `/courses`, instead of a badge.
2. **#833** — Distinguish current term from previous terms in course lists.
3. **#834** — Rename "Department" UI copy to "Course Subject".
4. **#835** — Move the "Chatbot" nav link to the bottom of the sidebar.

## #832 — TA / Student course separation

### Current behavior (bug)

`app/routes/courses.tsx` branches on a single condition:

```ts
) : isTA ? (
  <CoursesTaView courses={courses.filter((c) => taCourseIds.includes(c.id))} />
) : (
  <CoursesStudentView courses={courses.filter(...)} />
)
```

`isTA` is `taCourseIds.length > 0`. A user who is a TA in one course **and** enrolled as a student in another only ever sees `CoursesTaView` — their student courses are silently dropped from the page.

### Design

Introduce `CoursesMixedView` (`app/components/courses/courses-mixed-view.tsx`) that replaces the `isTA ? ... : ...` branch for the STUDENT/TA path:

- Section "Courses You Are Assisting In" — rendered (heading + grid) only if `taCourseIds.length > 0`. Reuses the existing TA card grid markup.
- Section "Courses You Are Enrolled In" — rendered only if `enrolledCourseIds.length > 0` (published only, same filter as today). Reuses the existing student card grid markup, **minus** the `extraBadges={["Enrolled"]}` pill (redundant now that the section heading conveys it).
- If only one of the two is non-empty, only that section renders — visually identical to today's single-role view, just via the shared component.
- If both are empty, show the existing "no courses" empty state (reuse current copy from `CoursesStudentView`).

`courses.tsx` changes:
- Delete the `isTA` branch; replace with `<CoursesMixedView courses={courses} taCourseIds={taCourseIds} enrolledCourseIds={enrolledCourseIds} />` for any non-admin/unit-admin/instructor user.
- `CoursesTaView` and `CoursesStudentView` are superseded by `CoursesMixedView` and removed (with their tests migrated).

## #833 — Current term vs previous terms

### Design

Add a pure helper in `app/lib/courses/term-grouping.ts`:

```ts
const TERM_ORDER = ['Winter', 'Spring', 'Summer', 'Fall'] as const

export function groupCoursesByTerm<T extends { term: string; year: number }>(
  courses: T[],
): { current: T[]; previous: T[] }
```

- Computes the max `(year, TERM_ORDER.indexOf(term))` pair across the input courses.
- Courses matching that exact `(year, term)` pair go into `current`; everything else into `previous`.
- If the list is empty, both arrays are empty. If all courses share the same term, `previous` is empty and no "Previous Terms" heading renders.
- Unrecognized term strings sort below all known terms (defensive default, shouldn't occur given the fixed Term `<Select>` in course-creation forms).

Applied in the three student-facing/instructor-facing grids that list multiple terms: `CoursesMixedView` (both its TA and Student sections, computed independently per section since a user's TA "current term" and student "current term" may differ), and `CoursesInstructorView`. Each section:
- Renders the `current` group in the existing grid, no new heading (current term is the implicit default).
- If `previous.length > 0`, renders a "Previous Terms" heading followed by the same grid layout for `previous`.

Admin and UnitAdmin views are unchanged — those personas manage courses across all terms deliberately and grouping would hide courses they need to act on.

## #834 — "Department" → "Course Subject"

Copy-only rename. No changes to the `department` field name, `DepartmentCombobox` component/prop names, or API/schema field names — only user-visible strings.

| File | Before | After |
|---|---|---|
| `courses-instructor-view.tsx` | `<Label>Department</Label>` | `<Label>Course Subject</Label>` |
| `courses-admin-view.tsx` (x2: create + edit) | `<Label>Department</Label>` | `<Label>Course Subject</Label>` |
| `courses-unit-admin-view.tsx` (x2) | `<Label>Department</Label>` | `<Label>Course Subject</Label>` |
| `department-combobox.tsx` | placeholder `"No department"` (call-site default) | `"No course subject"` |
| `course-detail-student-view.tsx` | `<p>Department</p>` | `<p>Course Subject</p>` |
| `course-detail-ta-view.tsx` | `<p>Department</p>` | `<p>Course Subject</p>` |
| `course-detail-manager-view.tsx` | `Department` label | `Course Subject` |
| `user-form-dialog.tsx` | `<FormLabel>Authorized Departments</FormLabel>` | `<FormLabel>Authorized Course Subjects</FormLabel>` |

`CourseCard`'s `departmentLabel`/`department` props and the `Pill` they render are untouched (they show the actual subject value, e.g. "Computer Science (CPSC)", not the word "Department").

## #835 — Move Chatbot nav to bottom-left

`app/lib/rbac/nav.ts`:
- Remove `{ key: 'chat', title: 'Chatbot', url: '/chat' }` from `CORE_NAV`.
- In `getNavSecondaryForUser`, unshift the Chatbot item onto the returned array (before `ADMIN_SECONDARY_NAV`/QM/AI Tutor), so it's the first item in the bottom nav group for every role.

No changes to `AppSidebar`/`SharedAppSidebar` rendering — `navSecondary` already renders at the bottom of the same (left) sidebar, so this is purely a data-ordering change in `nav.ts`.

## Testing

- Update/replace `CoursesList.test.tsx` and any `CoursesTaView`/`CoursesStudentView` unit tests to cover `CoursesMixedView`'s three cases: TA-only, student-only, both.
- New unit test for `groupCoursesByTerm` covering: empty input, single term, multiple terms same year, multiple years, tie-breaking within a year via `TERM_ORDER`.
- Update `AppSidebar.test.tsx` to assert Chatbot appears in the secondary/bottom nav, not the main nav.
- Update `TESTS.md` per repo convention.

## Out of scope

- No changes to the `department` DB column, Prisma schema, Zod schemas, or API payload field names.
- No changes to Admin/UnitAdmin course list views' term or role grouping.
- No new floating/overlay chat widget — #835 only reorders existing sidebar nav data.
