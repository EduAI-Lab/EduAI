// Canonical subject codes for Course.department (§19 — DepartmentSchema).
// All department codes stored in the DB and in user.authorizedUnits must come from this list.
export const DEPARTMENTS = [
  { code: 'COSC', label: 'Computer Science' },
  { code: 'MATH', label: 'Mathematics' },
  { code: 'PHYS', label: 'Physics' },
  { code: 'CHEM', label: 'Chemistry' },
  { code: 'BIOL', label: 'Biology' },
  { code: 'HIST', label: 'History' },
  { code: 'ENGL', label: 'English' },
  { code: 'PSYC', label: 'Psychology' },
  { code: 'SOCI', label: 'Sociology' },
  { code: 'ECON', label: 'Economics' },
  { code: 'STAT', label: 'Statistics' },
  { code: 'DATA', label: 'Data Science' },
] as const

export type DepartmentCode = (typeof DEPARTMENTS)[number]['code']

export function isDepartmentCode(code: string): code is DepartmentCode {
  return DEPARTMENTS.some((d) => d.code === code)
}

export function getDepartmentLabel(code: string): string {
  return DEPARTMENTS.find((d) => d.code === code)?.label ?? code
}
