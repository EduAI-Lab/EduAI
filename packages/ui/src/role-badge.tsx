import {
  IconShield,
  IconBuilding,
  IconSchool,
  IconUsers,
  IconUser,
} from "@tabler/icons-react"

const ROLE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  ADMIN:      { label: "Admin",      icon: IconShield, color: "var(--color-role-admin)" },
  UNIT_ADMIN: { label: "Unit Admin", icon: IconBuilding, color: "var(--color-role-unit-admin)" },
  INSTRUCTOR: { label: "Instructor", icon: IconSchool,  color: "var(--color-role-instructor)" },
  TA:         { label: "TA",         icon: IconUsers,  color: "var(--color-role-ta)" },
  STUDENT:    { label: "Student",    icon: IconUser,   color: "var(--color-role-student)" },
}

const FALLBACK = ROLE_CONFIG.STUDENT

export interface RoleBadgeProps {
  role: string
  className?: string
}

export function RoleBadge({ role, className = "" }: RoleBadgeProps) {
  const { label, icon: Icon, color } = ROLE_CONFIG[role] ?? FALLBACK
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 h-5 text-white shrink-0 whitespace-nowrap ${className}`}
      style={{ background: color }}
    >
      <Icon className="h-3 w-3" />
      <span className="text-xs">{label}</span>
    </span>
  )
}
