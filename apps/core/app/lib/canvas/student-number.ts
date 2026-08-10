/**
 * UBC student-number helpers (#818), kept in their own zod-free module.
 *
 * These are plain regex utilities the settings UI needs at runtime. They used to
 * live in `canvas/schemas.ts`, but that module builds zod schemas at eval time,
 * so importing any runtime binding from it dragged zod into the settings client
 * chunk (#1223). Splitting them out keeps zod server-side; `schemas.ts` still
 * consumes the pattern for `LinkRosterSchema`.
 */

/** UBC student numbers are exactly 8 numeric digits (#818). */
export const UBC_STUDENT_NUMBER_PATTERN = /^\d{8}$/;
export const UBC_STUDENT_NUMBER_MESSAGE = "Student number must be 8 digits";

export function isValidUbcStudentNumber(value: string): boolean {
  return UBC_STUDENT_NUMBER_PATTERN.test(value.trim());
}
