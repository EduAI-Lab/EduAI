/**
 * The answer to "is this input acceptable?", with the reason when it is not.
 *
 * The two arms are spelled out so a caller that has checked `isValid` can read
 * `error` without re-checking it, and so a validator cannot return a failure
 * with no explanation attached.
 */
export type ValidationResult =
  | { isValid: true; error?: undefined }
  | { isValid: false; error: string };
