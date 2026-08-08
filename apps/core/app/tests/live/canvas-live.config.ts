import { readFileSync, statSync } from "node:fs";

export const CANVAS_LIVE_DEFAULT_BASE_URL = "https://canvas.ubc.ca";
export const CANVAS_LIVE_DEFAULT_COURSE_ID = "204888";
export const CANVAS_LIVE_ALLOWED_ORIGIN = "https://canvas.ubc.ca";

export type CanvasLiveConfig = {
  enabled: true;
  baseUrl: string;
  courseId: string;
  token: string;
  coreUserId: string;
  approvedFileId: string;
  encryptionKey: string;
};

export type CanvasLiveDisabled = {
  enabled: false;
  reason: string;
};

export class CanvasLiveConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasLiveConfigError";
  }
}

export function assertApprovedTeacherCourse(courseIds: Iterable<string>, courseId: string): void {
  if (!new Set(courseIds).has(courseId)) {
    throw new CanvasLiveConfigError(
      `Approved sandbox course ${courseId} is not in the token owner's teacher course list`,
    );
  }
}

export function redactCanvasLiveSecrets(message: string, token?: string): string {
  let redacted = message;
  if (token) {
    redacted = redacted.split(token).join("[REDACTED]");
  }
  return redacted
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/(authorization|api[-_]?key|token|secret|password)\s*[:=]\s*[^,\s}]+/gi, "$1=[REDACTED]");
}

function readProtectedToken(env: NodeJS.ProcessEnv): string {
  const fromEnvironment = env.CANVAS_TOKEN?.trim();
  if (fromEnvironment) return fromEnvironment;

  const tokenFile = env.CANVAS_TOKEN_FILE?.trim();
  if (!tokenFile) {
    throw new CanvasLiveConfigError("Set CANVAS_TOKEN or CANVAS_TOKEN_FILE for live testing");
  }

  try {
    if (process.platform !== "win32") {
      const mode = statSync(tokenFile).mode & 0o777;
      if ((mode & 0o077) !== 0) {
        throw new CanvasLiveConfigError("CANVAS_TOKEN_FILE must be readable only by its owner");
      }
    }
    const token = readFileSync(tokenFile, "utf8").trim();
    if (!token) throw new CanvasLiveConfigError("CANVAS_TOKEN_FILE is empty");
    return token;
  } catch (error) {
    if (error instanceof CanvasLiveConfigError) throw error;
    throw new CanvasLiveConfigError("Could not read CANVAS_TOKEN_FILE");
  }
}

/**
 * Loads the deliberately opt-in live-test configuration. The defaults are the
 * approved sandbox values; changing either value is rejected rather than
 * allowing a live test to drift onto another Canvas host or course.
 */
export function loadCanvasLiveConfig(
  env: NodeJS.ProcessEnv = process.env,
): CanvasLiveConfig | CanvasLiveDisabled {
  if (env.CANVAS_LIVE_TESTS !== "1") {
    return { enabled: false, reason: "CANVAS_LIVE_TESTS is not set to 1" };
  }

  const baseUrl = (env.CANVAS_BASE_URL || CANVAS_LIVE_DEFAULT_BASE_URL).replace(/\/$/, "");
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new CanvasLiveConfigError("CANVAS_BASE_URL is not a valid URL");
  }

  if (parsed.origin !== CANVAS_LIVE_ALLOWED_ORIGIN || parsed.pathname !== "/") {
    throw new CanvasLiveConfigError("CANVAS_BASE_URL is not an allowlisted Canvas host");
  }

  const courseId = env.CANVAS_TEST_COURSE_ID || CANVAS_LIVE_DEFAULT_COURSE_ID;
  if (courseId !== CANVAS_LIVE_DEFAULT_COURSE_ID) {
    throw new CanvasLiveConfigError("CANVAS_TEST_COURSE_ID must be the approved sandbox course");
  }

  const coreUserId = env.CANVAS_LIVE_CORE_USER_ID?.trim();
  if (!coreUserId) {
    throw new CanvasLiveConfigError("CANVAS_LIVE_CORE_USER_ID is required for Core sync assertions");
  }

  const approvedFileId = env.CANVAS_LIVE_APPROVED_FILE_ID?.trim();
  if (!approvedFileId) {
    throw new CanvasLiveConfigError("CANVAS_LIVE_APPROVED_FILE_ID is required for the approved-file check");
  }

  const encryptionKey = env.ENCRYPTION_KEY?.trim();
  if (!encryptionKey) {
    throw new CanvasLiveConfigError("ENCRYPTION_KEY is required to store the live integration safely");
  }

  return {
    enabled: true,
    baseUrl,
    courseId,
    token: readProtectedToken(env),
    coreUserId,
    approvedFileId,
    encryptionKey,
  };
}
