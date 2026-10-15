/**
 * What a student reads when a self-enrollment link cannot be used. Shared by the
 * join page (#1756) and the page a join lands on after sign-up (#1961).
 *
 * A `Map` because the code arrives as a plain string from the library's result
 * union; an unrecognised one falls back to the generic message rather than
 * rendering a raw error code at a student.
 */
const ERROR_MESSAGES = new Map<string, string>([
  ["MISSING_TOKEN", "This enrollment link is missing its token."],
  ["INVALID_TOKEN", "This enrollment link is not valid."],
  ["COURSE_MISMATCH", "This enrollment link belongs to a different course."],
  ["COURSE_NOT_FOUND", "The course for this link no longer exists."],
  [
    "COURSE_NOT_PUBLISHED",
    "This course is not open to students yet. Try again once your instructor publishes it.",
  ],
  ["LINK_REVOKED", "This enrollment link was turned off. Ask your instructor for a new one."],
  ["LINK_EXPIRED", "This enrollment link has expired. Ask your instructor for a new one."],
  [
    "LINK_EXHAUSTED",
    "This enrollment link has reached its limit. Ask your instructor for a new one.",
  ],
]);

export function friendlySelfEnrollmentError(code: string): string {
  return ERROR_MESSAGES.get(code) ?? "Something went wrong with this enrollment link.";
}
