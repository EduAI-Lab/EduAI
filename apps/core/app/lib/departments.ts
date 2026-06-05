import { z } from "zod";

/**
 * Canonical unit subject codes for `Course.department` and
 * `User.authorizedUnits` (rbac-matrix.md §19 "Unit subject code casing").
 *
 * Every route that writes `Course.department` or `User.authorizedUnits` must
 * validate against this enum so a casing mismatch is caught at validation time
 * rather than silently scoping a UNIT_ADMIN into a ghost unit.
 *
 * NOTE: list derived from the seeded courses (prisma/seed.ts); extend as new
 * units onboard.
 */
export const DEPARTMENTS = [
  "BIOL",
  "COSC",
  "DATA",
  "ENGL",
  "HIST",
  "MATH",
  "PHIL",
  "PHYS",
  "PSYO",
  "STAT",
] as const;

export const DepartmentSchema = z.enum(DEPARTMENTS);

export type Department = z.infer<typeof DepartmentSchema>;
