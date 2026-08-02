/**
 * Oracle for tests/models/chat-entry-admission.pict (census docs/PICT_CENSUS.md § S3).
 *
 * Spec-derived verdict for POST /api/chat admission gates (issue #1182), modeled
 * from routes/api/chat.ts (~462–788) admission order — not downstream RAG or
 * provider routing:
 *
 *   1. Unauthenticated callers (no session, no service key) → 401.
 *   2. proxyUser without a verified admin API key session → 403.
 *   3. chatMode=admin blocked for service-key callers and non-ADMIN acting users → 403.
 *   4. Persisted chat chatbotType mismatch → 410; explicit course-pin conflict → 409.
 *   5. Course-scoped access: missing course → 404; no relationship or student on
 *      unpublished course → 403.
 *
 * Service-key callers receive synthetic ADMIN platform role for course-access
 * resolution when a course is present — that is an admission fact, not a claim
 * about unrestricted RAG injection (which is governed separately).
 *
 * Rows are constrained so COURSE_REQUIRED (400) and proxy resolve failures (400)
 * never appear — those sit outside this oracle's status set.
 *
 * App-agnostic: adapters map the verdict to HTTP status from action().
 */

export type ChatEntryAdmissionRow = {
  Auth: "session" | "service-key" | "admin-api-key" | "none";
  ProxyUser: "none" | "valid" | "blocked";
  ChatMode: "user" | "admin";
  CoursePublished: "yes" | "no";
  Enrollment: "none" | "student" | "instructor";
  PersistedChat: "none" | "ok" | "type-mismatch" | "pin-conflict";
};

export type ChatAdmissionVerdict =
  | { outcome: "allowed" }
  | { outcome: "denied"; status: 401 | 403 | 404 | 409 | 410 };

function isServiceKeyCaller(row: ChatEntryAdmissionRow): boolean {
  return row.Auth === "service-key";
}

/** Platform role of the acting user after proxy resolution (for admin chatMode gate). */
function actingPlatformRole(row: ChatEntryAdmissionRow): "ADMIN" | "INSTRUCTOR" | "STUDENT" {
  if (row.ProxyUser === "valid") {
    return row.Enrollment === "instructor" ? "INSTRUCTOR" : "STUDENT";
  }
  if (isServiceKeyCaller(row) || row.Auth === "admin-api-key") {
    return "ADMIN";
  }
  // Session auth: admin chatMode rows are exercised with an ADMIN platform account.
  if (row.Auth === "session" && row.ChatMode === "admin") {
    return "ADMIN";
  }
  return row.Enrollment === "instructor" ? "INSTRUCTOR" : "STUDENT";
}

/** Course access level used by the §10 publish gate (null = no relationship). */
function courseAccessLevel(
  row: ChatEntryAdmissionRow,
): "admin" | "instructor" | "student" | null {
  if (row.Enrollment === "none") {
    if (isServiceKeyCaller(row) || row.Auth === "admin-api-key") {
      return "admin";
    }
    return null;
  }

  if (row.ProxyUser === "valid" || row.Auth === "session") {
    return row.Enrollment === "instructor" ? "instructor" : "student";
  }

  // Service-key / admin-api-key without proxy: synthetic ADMIN platform role.
  return "admin";
}

function hasCourseContext(row: ChatEntryAdmissionRow): boolean {
  return row.Enrollment !== "none" || row.PersistedChat === "pin-conflict";
}

function canOmitCourse(row: ChatEntryAdmissionRow): boolean {
  return isServiceKeyCaller(row) || row.ChatMode === "admin";
}

export function chatEntryAdmissionOracle(row: ChatEntryAdmissionRow): ChatAdmissionVerdict {
  if (row.Auth === "none") {
    return { outcome: "denied", status: 401 };
  }

  if (row.ProxyUser === "blocked") {
    return { outcome: "denied", status: 403 };
  }

  if (row.ChatMode === "admin") {
    if (isServiceKeyCaller(row) || actingPlatformRole(row) !== "ADMIN") {
      return { outcome: "denied", status: 403 };
    }
  }

  if (row.PersistedChat === "type-mismatch") {
    return { outcome: "denied", status: 410 };
  }

  if (row.PersistedChat === "pin-conflict") {
    return { outcome: "denied", status: 409 };
  }

  if (!canOmitCourse(row) && !hasCourseContext(row)) {
    // Constrained away in the .pict model — defensive only.
    return { outcome: "denied", status: 403 };
  }

  if (hasCourseContext(row)) {
    const access = courseAccessLevel(row);
    if (access === null) {
      return { outcome: "denied", status: 403 };
    }
    if (access === "student" && row.CoursePublished === "no") {
      return { outcome: "denied", status: 403 };
    }
  }

  return { outcome: "allowed" };
}

/** Maps the oracle verdict to the HTTP status the chat action should return at admission. */
export function expectedChatAdmissionStatus(row: ChatEntryAdmissionRow): number {
  const verdict = chatEntryAdmissionOracle(row);
  return verdict.outcome === "allowed" ? 200 : verdict.status;
}
