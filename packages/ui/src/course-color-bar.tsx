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

export interface CourseCardHeroProps {
  index: number
  code: string
  className?: string
}

/** Visual header band for course cards (#696) — deterministic colour from index. */
export function CourseCardHero({ index, code, className }: CourseCardHeroProps) {
  const color = COURSE_COLORS[index % COURSE_COLORS.length]
  return (
    <div
      data-testid="course-card-hero"
      className={className}
      style={{
        height: 56,
        background: `linear-gradient(145deg, ${color} 0%, color-mix(in oklch, ${color} 55%, black) 100%)`,
      }}
    >
      <div className="flex h-full items-end px-4 pb-2.5">
        <span className="text-sm font-bold tracking-tight text-white drop-shadow-sm">{code}</span>
      </div>
    </div>
  )
}
