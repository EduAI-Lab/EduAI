import { z } from "zod";

// Canonical subject codes for Course.department (§19 — DepartmentSchema).
// All department codes stored in the DB and in user.authorizedUnits must come from this list.
export const DEPARTMENTS = [
  { code: 'BIOL', label: 'Biology' },
  { code: 'CHEM', label: 'Chemistry' },
  { code: 'COSC', label: 'Computer Science' },
  { code: 'DATA', label: 'Data Science' },
  { code: 'ECON', label: 'Economics' },
  { code: 'ENGL', label: 'English' },
  { code: 'HIST', label: 'History' },
  { code: 'MATH', label: 'Mathematics' },
  { code: 'PHIL', label: 'Philosophy' },
  { code: 'PHYS', label: 'Physics' },
  { code: 'PSYC', label: 'Psychology' },
  { code: 'SOCI', label: 'Sociology' },
  { code: 'STAT', label: 'Statistics' },
] as const;

export type DepartmentCode = (typeof DEPARTMENTS)[number]['code'];

export const DepartmentSchema = z.enum(
  DEPARTMENTS.map((d) => d.code) as unknown as [DepartmentCode, ...DepartmentCode[]],
);

export type Department = DepartmentCode;

export function isDepartmentCode(code: string): code is DepartmentCode {
  return DEPARTMENTS.some((d) => d.code === code);
}

export function getDepartmentLabel(code: string): string {
  return DEPARTMENTS.find((d) => d.code === code)?.label ?? code;
}
