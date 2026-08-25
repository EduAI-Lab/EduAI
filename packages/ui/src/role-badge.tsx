import { IconShield, IconBuilding, IconSchool, IconUsers, IconUser } from "@tabler/icons-react";

/** How one role renders: its short label, its glyph, and its brand colour. */
type RoleAppearance = { label: string; icon: React.ElementType; color: string };

// Named separately because it is also what an unrecognised role renders as.
const STUDENT_APPEARANCE = {
  label: "Student",
  icon: IconUser,
  color: "var(--color-role-student)",
} satisfies RoleAppearance;

// A `Map` rather than an object: `role` arrives as a bare string from three
// apps' payloads, so the lookup has to be able to miss.
const ROLE_CONFIG = new Map<string, RoleAppearance>([
  ["ADMIN", { label: "Admin", icon: IconShield, color: "var(--color-role-admin)" }],
  [
    "UNIT_ADMIN",
    { label: "Unit Admin", icon: IconBuilding, color: "var(--color-role-unit-admin)" },
  ],
  ["INSTRUCTOR", { label: "Instructor", icon: IconSchool, color: "var(--color-role-instructor)" }],
  ["TA", { label: "TA", icon: IconUsers, color: "var(--color-role-ta)" }],
  ["STUDENT", STUDENT_APPEARANCE],
]);

export interface RoleBadgeProps {
  role: string;
  className?: string;
}

export function RoleBadge({ role, className = "" }: RoleBadgeProps) {
  const { label, icon: Icon, color } = ROLE_CONFIG.get(role) ?? STUDENT_APPEARANCE;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 h-5 text-white shrink-0 whitespace-nowrap ${className}`}
      style={{ background: color }}
    >
      <Icon className="h-3 w-3" />
      <span className="text-xs">{label}</span>
    </span>
  );
}
