export const COURSE_COLORS = [
  "var(--color-course-1)",
  "var(--color-course-2)",
  "var(--color-course-3)",
  "var(--color-course-4)",
  "var(--color-course-5)",
  "var(--color-course-6)",
]

export interface CourseColorBarProps {
  index: number
}

export function CourseColorBar({ index }: CourseColorBarProps) {
  return (
    <div style={{ height: 4, background: COURSE_COLORS[index % COURSE_COLORS.length] }} />
  )
}
