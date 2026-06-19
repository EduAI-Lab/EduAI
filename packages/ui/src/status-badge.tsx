export interface StatusBadgeProps {
  active: boolean
  activeLabel?: string
  inactiveLabel?: string
  className?: string
}

export function StatusBadge({ active, activeLabel = "Active", inactiveLabel = "Inactive", className }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full${className ? ` ${className}` : ""}`}
      style={{
        background: active ? "var(--color-success-100)" : "var(--muted)",
        color: active ? "var(--color-success-700)" : "var(--muted-foreground)",
      }}
    >
      <span
        className="w-[5px] h-[5px] rounded-full flex-shrink-0"
        style={{ background: active ? "var(--color-success-500)" : "var(--muted-foreground)" }}
      />
      {active ? activeLabel : inactiveLabel}
    </span>
  )
}
