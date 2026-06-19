export interface CourseHeroCardProps {
  code: string
  term: string
  year?: string | number | null
  name: string
  description?: string | null
  badges?: string[]
  topRightBadges?: string[]
  topics?: string[]
  className?: string
}

export function CourseHeroCard({
  code,
  term,
  year,
  name,
  description,
  badges = [],
  topRightBadges = [],
  topics = [],
  className,
}: CourseHeroCardProps) {
  return (
    <div
      className={`rounded-[var(--radius-xl)] p-6 text-white mb-4${className ? ` ${className}` : ""}`}
      style={{ background: "linear-gradient(135deg, oklch(0.192 0.055 259) 0%, oklch(0.42 0.14 232) 100%)" }}
    >
      {/* Top row: code/term left, role badges right */}
      <div className="flex items-start justify-between gap-4 mb-1">
        <div className="text-[11px] opacity-70 font-semibold uppercase tracking-widest">
          {code} · {term} {year ?? ""}
        </div>
        {topRightBadges.length > 0 && (
          <div className="flex gap-2 flex-shrink-0">
            {topRightBadges.map((label) => (
              <span
                key={label}
                className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
                style={{ background: "rgba(255,255,255,0.2)" }}
              >
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      <h1 className="text-xl font-bold mb-2 leading-snug">{code}: {name}</h1>

      {description && (
        <p className="text-[13px] opacity-85 leading-relaxed max-w-[560px]">{description}</p>
      )}

      {/* Topics chips */}
      {topics.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {topics.map((t) => (
            <span
              key={t}
              className="text-[11px] font-medium px-2.5 py-0.5 rounded-full"
              style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)" }}
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Bottom badges (legacy / status badges) */}
      {badges.length > 0 && (
        <div className="flex gap-2 mt-4">
          {badges.map((label) => (
            <span
              key={label}
              className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
              style={{ background: "rgba(255,255,255,0.2)" }}
            >
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
