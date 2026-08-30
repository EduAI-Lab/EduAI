/**
 * @file Typed wire layer between the SPA and the Express API.
 *
 * Responsibility: Owns every HTTP call shape the frontend makes; centralizes
 *   cookie-session credentials, error normalization, and the cross-cutting
 *   redirect-on-auth-failure convention.
 * Callers: All route loaders, hooks, and components that need server data
 *   (e.g. `useLocalUser`, `useCourseTopics`, instructor/student route modules).
 * Gotchas:
 *   - Every request sets `credentials: 'include'` so Better Auth session
 *     cookies are attached. Do not switch to a bearer/JWT flow without
 *     updating the entire stack.
 *   - The shared `http()` helper turns a 401 into a hard redirect to Core's
 *     login page (`VITE_CORE_URL/login?redirect=<current-url>`). Route guards
 *     rely on this behavior. A 403 is surfaced as a thrown error (NOT a
 *     redirect) — the caller is already authenticated, so re-login would loop.
 *   - `logout` deliberately bypasses `http()` to avoid the redirect loop
 *     that would otherwise fire on the post-sign-out 401.
 *   - `updateActivity` accepts three legal `options` shapes for caller
 *     convenience and normalizes them to a flat `string[]` on the wire.
 * Related: `server/src/utils/mappers.js` — request/response shapes here MUST
 *   match the server mappers; silent breakage risk if they drift.
 */

import { toast } from "sonner";
import { z } from "zod";
import {
  activityAnalyticsRowSchema,
  activityAnswerResultSchema,
  activityFeedbackResultSchema,
  activityFeedbackRowSchema,
  activityMoveSchema,
  activitySchema,
  adminAiModelPolicyResponseSchema,
  adminBugReportRowSchema,
  adminEnrollmentDataSchema,
  adminUserPageSchema,
  aiModelSchema,
  aiStatusSchema,
  aiTraceRowSchema,
  apiKeyValidationSchema,
  bugReportStatusUpdatedSchema,
  chatMessagesSchema,
  chatSessionRowSchema,
  courseDetailSchema,
  courseFacetsSchema,
  courseSchema,
  dashboardStatsSchema,
  eduAiApiKeyStatusSchema,
  gradedSubmissionSchema,
  importableActivitySchema,
  lessonContextSchema,
  lessonMoveSchema,
  lessonSchema,
  meSchema,
  moduleContextSchema,
  moduleMoveSchema,
  moduleSchema,
  okSchema,
  okWithRoleSchema,
  paginatedSchema,
  studentMetricRowSchema,
  submissionRowSchema,
  suggestedPromptSchema,
  topicSchema,
} from "./api-schemas";
import type {
  AdminBugReportRow,
  AdminEnrollmentData,
  AdminAiModelPolicy,
  AdminUser,
  AdminUserPage,
  Activity,
  ActivityAnswerResult,
  ActivityAnalyticsRow,
  ActivityFeedbackRow,
  ActivityFeedbackResult,
  AiModel,
  BugReportCreatePayload,
  BugReportStatus,
  Course,
  EduAiApiKeyStatus,
  EnrollmentRole,
  Lesson,
  Module,
  ModuleDetail,
  StudentMetricRow,
  SubmissionRow,
  SuggestedPrompt,
  Topic,
  User,
  UserProviderSettingStatus,
} from "./types";
import { getCoreLoginUrl } from "./coreUrl";
import type { BankQuestion } from "./bankQuestionToActivityDraft";

/**
 * Set by course endpoints (#1072 step 2) when a request degraded gracefully
 * because EduAI Core couldn't be reached — the response still succeeds (200)
 * with locally-anchored, possibly-stale data instead of hard-erroring (mirrors
 * the #1066 topic fail-soft pattern). `http()` below surfaces it as a single
 * deduped toast (stable `id`, so concurrent course/stat calls during one page
 * load collapse into one notice instead of stacking).
 */
const CORE_STATUS_HEADER = "X-Core-Status";

export const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";

/**
 * The platform pagination envelope (#1043), matching the AI-Tutor server's
 * `paginated()` helper and EduAI Core's contract (#1041). Every list endpoint
 * that was previously a bare array now returns this shape.
 *
 * `total` is the full count matching the query (not the page length) — reader
 * code that used to rely on `array.length` for a total, drive "select all", or
 * derive a tree/ordinal from a complete list MUST read `total` and treat a
 * short `data` as a page, not the whole set.
 */
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Default page size for the structure-bounded "tree" endpoints (modules,
 * lessons, activities, topics).
 *
 * #1207 turned these into real pagers, so this is now an ordinary page size
 * rather than a "load everything" bound. The three readers that used to need
 * the whole set no longer do:
 *   - reorder goes through `PATCH .../position` with an absolute ordinal, so a
 *     drag on page 3 never needs page 1 in memory;
 *   - the lesson player's "3.2" ordinal comes from `GET /lessons/:id/context`;
 *   - the player's activity walk appends the next page as the student advances.
 * Callers that still want a large single read pass their own `pageSize`.
 */
export const TREE_PAGE_SIZE = 25;

/**
 * Single-read bound for the copy/import pickers and the student module page.
 *
 * These are the readers #1207 did *not* convert to pagers: a checkbox list of
 * "which modules to copy" and the student's lesson list have no page controls,
 * so falling back to `TREE_PAGE_SIZE` would silently hide rows past the 25th
 * with nothing on screen to say so. Holding them at the pre-#1207 bound keeps
 * that from regressing until they grow real pagers.
 */
export const FULL_TREE_READ_PAGE_SIZE = 200;

/**
 * Topics stay on a large single read (#1207). Unlike the tree lists they have
 * no pager: their consumers are `<Select>` dropdowns that must be able to
 * `.find()` an already-saved value, and a topic row is tiny. The hook layer
 * (`useCourseTopics`) appends further pages on demand and surfaces the count,
 * so the bound is not silent.
 */
export const TOPIC_PAGE_SIZE = 200;

/**
 * Page size for the activity import picker. Deliberately small: the picker is a
 * search-as-you-type surface over the caller's whole activity corpus, not a
 * pager, so the right move is a short candidate list per keystroke plus a
 * visible "more matches exist" note.
 */
export const IMPORT_PICKER_PAGE_SIZE = 25;

/**
 * Result of a `move*ToPosition` call: the ordinal the row now occupies and the
 * sibling count it was resolved against. The server CLAMPS an out-of-range
 * ordinal, so `position` may differ from what was requested — callers should
 * trust this value over their own optimistic guess.
 */
export interface MoveResult {
  position: number;
  total: number;
}

/**
 * Structural position of a lesson within its module and course. Ordinals are
 * 1-based and reflect the caller's visibility: a student's ordinals count only
 * published siblings, matching the tree they can actually navigate.
 */
export interface ModuleContext {
  moduleOrdinal: number;
  moduleTotal: number;
}

export interface LessonContext {
  moduleOrdinal: number;
  lessonOrdinal: number;
  moduleTotal: number;
  lessonTotal: number;
  prevLessonId: number | null;
  nextLessonId: number | null;
}

/**
 * Ancestry returned by `GET /lessons/:id/breadcrumb` (#1334). Collapses the
 * former moduleById + courseById + /context fan-out into one follow-up call
 * that runs after the lesson body paints (not on the initial lesson GET).
 */
export interface LessonBreadcrumb extends LessonContext {
  module: ModuleDetail;
  course: Course;
  /**
   * The caller's enrollment role for THIS lesson's course, or `null` when they
   * have no learner enrollment (elevated/instructor access, or unresolved). Use
   * this — never the global `/api/me` effective role — to gate course-scoped
   * capabilities such as answer submission: a user who is a TA here but a
   * STUDENT in another course must be withheld here yet permitted there (#1626).
   */
  viewerEnrollmentRole: EnrollmentRole | null;
}

/**
 * Default page size for course lists (#1043 Group A). The server REQUIRES
 * page/pageSize, so callers that don't drive an explicit pager send this bounded
 * page instead of an unbounded read; views with a real pager pass their own.
 *
 * #1208: `GET /api/courses` now supports server-side `search`, `term`, `status`
 * and `progress`, so a course past this bound is reachable by narrowing rather
 * than by paging. The switcher and command palette search server-side; the
 * instructor and student lists thread their filters through the loader URL. What
 * this bound still governs is the unsearched first page — surfaces that render
 * one (the dashboard panels) must disclose the truncation rather than imply the
 * list is complete; see `TruncatedListNotice`.
 *
 * NB: `listImportableActivities` also borrows this constant (#1207 owns that
 * call site) — don't rename it without coordinating.
 */
export const COURSE_LIST_PAGE_SIZE = 200;

/** Query params accepted by every paginated list endpoint. */
export interface ListParams {
  page?: number;
  pageSize?: number;
  /**
   * #1207: filtering happens SERVER-SIDE, in SQL. Callers pass the raw term and
   * must NOT also filter the returned page — doing both is the bug this issue
   * exists to fix, where a match on page 2 renders as "no results" while the
   * pager below reports a non-zero total.
   */
  search?: string | null;
}

/**
 * Filter/search params accepted by `GET /api/courses` (#1208).
 *
 * The array dimensions are repeatable query params — OR within a dimension, AND
 * across them, matching `CourseListView`'s toolbar semantics.
 */
/** Body of `POST /api/courses/:id/modules`. `position` defaults server-side. */
export interface ModuleCreatePayload {
  title: string;
  description?: string;
  position?: number;
}

export interface CourseListParams {
  page?: number;
  pageSize?: number;
  /** Free text over title + code. */
  search?: string;
  /** Canonical `term::year` keys, e.g. `"W1::2026"`. */
  term?: string[];
  /** `"published"` | `"draft"`. */
  status?: string[];
  /** `"not-started"` | `"in-progress"` | `"completed"`. */
  progress?: string[];
}

/** Filter options for the course list, scoped to the caller (#1208). */
export interface CourseFacets {
  terms: string[];
  statuses: string[];
  progress: string[];
  /**
   * Core was unreachable, so every catalog-side filter fail-closes to zero rows.
   * The `X-Core-Status` header says the same thing, but `http()` consumes it into
   * a generic toast and callers never see it — leaving the list to report "No
   * courses match", which reads as "your course is gone" rather than "search is
   * degraded". Carried in the body so the routes can say which one it is.
   */
  coreUnavailable: boolean;
}

/**
 * Serialize course list params. Blank search and empty arrays are omitted
 * entirely so an unfiltered request is byte-identical to the pre-#1208 one.
 */
function courseListQuery(params?: CourseListParams): string {
  const qs = new URLSearchParams();
  qs.set("page", String(params?.page ?? 1));
  qs.set("pageSize", String(params?.pageSize ?? COURSE_LIST_PAGE_SIZE));
  const search = params?.search?.trim();
  if (search) qs.set("search", search);
  for (const key of ["term", "status", "progress"] as const) {
    for (const value of params?.[key] ?? []) {
      if (value) qs.append(key, value);
    }
  }
  return `?${qs.toString()}`;
}

/**
 * Serialize list params into a query string. Returns '' when empty so callers
 * can append unconditionally.
 *
 * Callers must pass BOTH `page` and `pageSize` for endpoints that parse in
 * required mode — the server 400s (`PAGINATION_REQUIRED`) on a half-supplied
 * pair, so every call site below defaults `page: 1` alongside its page size.
 *
 * An empty or whitespace-only `search` is omitted rather than sent as
 * `search=`: the server treats both as "no filter", but omitting it keeps the
 * URL clean and the request cacheable.
 */
function pageQuery(params?: ListParams): string {
  if (!params) return "";
  const qs = new URLSearchParams();
  if (params.page !== undefined) qs.set("page", String(params.page));
  if (params.pageSize !== undefined) qs.set("pageSize", String(params.pageSize));
  if (params.search != null && params.search.trim() !== "") {
    qs.set("search", params.search.trim());
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/**
 * Hard ceiling for the session probe `/api/me`. If the AT API is up but its
 * upstream Core `/api/sessions/validate` hangs, a bare `/api/me` would never
 * settle — stranding loaders and leaving the "Initializing your workspace"
 * spinner running forever. Applied opt-in via `timeoutMs` on that call (below),
 * NOT globally: most of the API surface (imports, sync) may legitimately run
 * longer and hasn't been audited against a blanket cutoff.
 */
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Local response shapes for endpoints not yet modeled in `./types`. Kept here
 * (rather than in the shared types file, which this module does not own)
 * until the canonical types land; fields are optional wherever the server
 * response shape isn't locked down yet, to avoid fabricating a contract.
 */
export interface GradedSubmission extends SubmissionRow {
  score?: number | null;
  feedback?: string | null;
}

export interface ImportableActivity {
  id: number;
  title?: string | null;
  type?: "MCQ" | "SHORT_TEXT";
  lessonId?: number;
  lessonTitle?: string | null;
  moduleTitle?: string | null;
  courseId?: number;
  courseTitle?: string | null;
}

export interface DashboardStats {
  enrolledCourses?: number;
  coursesInProgress?: number;
  coursesCompleted?: number;
  yourCourses?: number;
  publishedCourses?: number;
  draftCourses?: number;
  syncedCourses?: number;
  totalUsers?: number;
  totalCourses?: number;
  openBugReports?: number;
  totalBugReports?: number;
  pendingSubmissions?: number;
  /** Ungraded submissions across the caller's teaching/assisting courses — the
   * grading queue depth surfaced on the instructor/TA dashboards (#1626). */
  submissionsToReview?: number;
}

export interface AiTraceRow {
  id: number;
  mode?: string | null;
  knowledgeLevel?: string | null;
  tutorModelId?: string | null;
  supervisorModelId?: string | null;
  iterationCount?: number | null;
  finalOutcome?: string | null;
  createdAt?: string;
  user?: { id: string; name?: string | null } | null;
  activity?: { id: number; title?: string | null } | null;
  courseId?: number | null;
  courseTitle?: string | null;
}

/**
 * Thrown when the request never reached the server (e.g. connection refused
 * because the API is still booting on a fresh dev-stack start). Distinct from
 * an authenticated-but-rejected response so callers can retry instead of
 * treating it as "logged out".
 */
export class ApiNetworkError extends Error {
  constructor(message = "Network request failed") {
    super(message);
    this.name = "ApiNetworkError";
  }
}

/**
 * Thrown for any non-OK HTTP response `http()` doesn't handle specially.
 * Carries `status` so a route error boundary can tell "no such course" apart
 * from "something broke"; the message is still the server's body text, so
 * existing `error.message` callers are unaffected.
 */
export class ApiHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
  }
}

/** Thrown when a request is aborted by `http()`'s own timeout, not by a caller-supplied signal. */
export class ApiTimeoutError extends Error {
  constructor(message = "Request timed out") {
    super(message);
    this.name = "ApiTimeoutError";
  }
}

// #999: the chat send path has no bound on how long a hung upstream call can
// leave the UI showing "Thinking...". This is the client-side half of that
// fix — the AI Tutor server also bounds its own EduAI round-trip
// (EDUAI_CALL_TIMEOUT_MS, default 45s) so this should normally see a clean
// 504 response (mapped to ApiTimeoutError below) before ever firing; it
// exists as a backstop. Opt-in via `timeoutMs` — deliberately NOT a global
// default, since most of the API surface (imports, sync operations, etc.)
// may legitimately take longer than a chat turn and hasn't been audited
// against a blanket cutoff.
export const CHAT_TIMEOUT_MS = 60_000;

/**
 * Single fetch wrapper for the entire API surface. Every caller goes through
 * here so the cookie-credential semantics and the 401/403 redirect-to-Core-login
 * behavior remain consistent. Callers that must NOT trigger the redirect
 * (e.g. sign-out) should bypass this helper intentionally.
 *
 * `init.signal`, if provided, lets the caller cancel the request directly
 * (e.g. a "Stop generating" button) — it's merged with the internal timeout
 * controller (when `init.timeoutMs` is also set) rather than passed straight
 * through, so both can independently abort the same underlying fetch.
 * Without `timeoutMs`, only `init.signal` (if provided) can abort — there is
 * no default timeout.
 */
async function http(path: string, init?: RequestInit & { timeoutMs?: number }) {
  const headers: Record<string, string> = {};
  headers["Content-Type"] = "application/json";

  const { signal: callerSignal, timeoutMs, ...rest } = init ?? {};
  const controller = new AbortController();
  const TIMEOUT_REASON = Symbol("http-timeout");
  const timeoutId =
    timeoutMs != null ? setTimeout(() => controller.abort(TIMEOUT_REASON), timeoutMs) : undefined;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort(callerSignal.reason);
    else
      callerSignal.addEventListener("abort", () => controller.abort(callerSignal.reason), {
        once: true,
      });
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      credentials: "include",
      headers: {
        ...headers,
        ...init?.headers,
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.reason === TIMEOUT_REASON) {
      throw new ApiTimeoutError();
    }
    if (controller.signal.aborted) {
      // Caller-initiated cancellation (e.g. Stop button) — rethrow as-is so
      // callers can distinguish it from a real failure via `error.name`.
      throw err;
    }
    throw new ApiNetworkError();
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }

  if (!res.ok) {
    // 401 = unauthenticated → bounce to Core login so a session can be
    // established. 403 = authenticated but not authorized for THIS resource;
    // redirecting to login would just bounce an already-signed-in user
    // straight back here and loop forever (e.g. a UNIT_ADMIN deep-linking to a
    // lesson outside their unit). Surface 403 as a normal error instead so the
    // route's error boundary can render it.
    if (res.status === 401) {
      window.location.href = getCoreLoginUrl();
      throw new Error("Authentication required");
    }
    // 504 = the AI Tutor server's own upstream call timed out (see
    // EDUAI_CALL_TIMEOUT_MS in callEduAI()) — this is the common case in
    // practice, since the server's 45s bound fires well before this client's
    // own timeoutMs backstop. Map it to the same ApiTimeoutError callers
    // already handle for a client-side timeout, so "took too long" is shown
    // either way.
    if (res.status === 504) {
      throw new ApiTimeoutError();
    }
    const text = await res.text();
    throw new ApiHttpError(res.status, text || `Request failed: ${res.status}`);
  }
  // Optional chaining: some lightweight test doubles for `Response` omit
  // `headers` entirely — a real `fetch` Response always has it.
  if (res.headers?.get?.(CORE_STATUS_HEADER) === "unavailable") {
    toast.warning("EduAI Core is unavailable — course data may be out of date.", {
      id: "core-unavailable",
    });
  }
  // 204 No Content (e.g. DELETE) has no body — `res.json()` would throw on the
  // empty payload, so short-circuit to null.
  if (res.status === 204) return null;
  return res.json();
}

/**
 * De-dupes concurrent `/api/me` calls. On a single navigation both the route
 * guard (`requireClientUser`) and the `AuthProvider` mount effect call
 * `api.me()` independently — without coalescing, that is two full round-trips
 * to Core's `/api/sessions/validate` per page. While a request is in flight,
 * additional callers share it; the slot clears as soon as it settles, so the
 * result is never cached across navigations (auth state stays fresh).
 */
/**
 * Validate a response against the contract its endpoint publishes.
 *
 * `http` hands back whatever the server sent, so this is where a response
 * becomes a typed value: the schema is the endpoint's declared shape, and a
 * payload that no longer matches fails here rather than several components
 * later as an undefined field.
 */
/** A JSON request body: what `JSON.stringify` is handed on the way out. */
type WireValue = string | number | boolean | null | undefined | WireValue[] | WireBody;
type WireBody = { [key: string]: WireValue };

/**
 * The body of a `PATCH /api/activities/:id`. Named because the editor and the
 * lesson page both assemble one field by field before sending it, and an
 * accumulator needs a contract to accumulate into.
 */
export type ActivityUpdateBody = {
  title?: string | null;
  instructionsMd?: string;
  question?: string;
  type?: "MCQ" | "SHORT_TEXT";
  options?: { choices?: string[] } | string[] | null;
  answer?: any;
  hints?: string[];
  promptTemplateId?: number | null;
  customPrompt?: string | null;
  customPromptTitle?: string | null;
  mainTopicId?: string | number;
  secondaryTopicIds?: (string | number)[];
  enableTeachMode?: boolean;
  enableGuideMode?: boolean;
  enableCustomMode?: boolean;
};

/**
 * A grade override: a score, a correctness flag, or both. Absent fields leave
 * the stored value alone, which is why every field is optional; an explicit
 * `null` clears the stored value.
 */
export type SubmissionGradeBody = { score?: number | null; isCorrect?: boolean | null };

function decode<Schema extends z.ZodTypeAny>(
  response: Promise<unknown>,
  schema: Schema,
): Promise<z.infer<Schema>> {
  return response.then((body) => schema.parse(body));
}

/**
 * The AI request schemas take `topicId` as the cuid string `Topic.id` actually
 * is (`shared/schemas/aiGuidance.js`). Callers hold `Topic["id"]`, which is
 * still `string | number` for the numeric fixtures, so stringify it here rather
 * than making every call site do it.
 */
function withWireTopicId<Params extends { topicId?: string | number }>(
  params: Params,
): Omit<Params, "topicId"> & { topicId?: string } {
  const { topicId, ...rest } = params;
  return topicId === undefined ? rest : { ...rest, topicId: String(topicId) };
}

let meInFlight: Promise<{ user: User | null }> | null = null;

export const api = {
  me: () => {
    if (meInFlight) return meInFlight;
    // #446: bound the session probe so a hung upstream can't strand the
    // "Initializing your workspace" spinner forever (surfaced as ApiTimeoutError).
    meInFlight = decode(http("/api/me", { timeoutMs: REQUEST_TIMEOUT_MS }), meSchema).finally(
      () => {
        meInFlight = null;
      },
    );
    return meInFlight;
  },
  aiStatus: (signal?: AbortSignal) => decode(http("/api/ai-status", { signal }), aiStatusSchema),
  listCourses: (params?: CourseListParams) =>
    decode(http(`/api/courses${courseListQuery(params)}`), paginatedSchema(courseSchema)),
  /**
   * Filter options for the course list, spanning the caller's whole accessible
   * set rather than the loaded page (#1208). Fetch once per mount — these change
   * rarely, and re-fetching per keystroke would be pure waste.
   */
  listCourseFacets: () => decode(http("/api/courses/facets"), courseFacetsSchema),
  courseById: (courseId: number) => decode(http(`/api/courses/${courseId}`), courseDetailSchema),
  /**
   * Flip a course published. Course publish state is owned by EduAI Core, so
   * this proxies through to Core and re-reads it; `corePublishStale` on the
   * result means the write landed but the read-back didn't (#225 SEAM-04).
   */
  publishCourse: (courseId: number) =>
    http(`/api/courses/${courseId}/publish`, {
      method: "PATCH",
    }) as Promise<Course>,
  unpublishCourse: (courseId: number) =>
    http(`/api/courses/${courseId}/unpublish`, {
      method: "PATCH",
    }) as Promise<Course>,
  importIntoCourse: (
    courseId: number,
    payload: {
      sourceCourseId?: number;
      moduleIds?: number[];
      lessonIds?: number[];
      targetModuleId?: number;
    },
  ) =>
    http(`/api/courses/${courseId}/import`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  modulesForCourse: (courseId: number, params?: ListParams) =>
    decode(
      http(
        `/api/courses/${courseId}/modules${pageQuery({ page: 1, pageSize: TREE_PAGE_SIZE, ...params })}`,
      ),
      paginatedSchema(moduleSchema),
    ),
  moduleById: (moduleId: number) => http(`/api/modules/${moduleId}`),
  createModule: (courseId: number, payload: ModuleCreatePayload) =>
    http(`/api/courses/${courseId}/modules`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  publishModule: (moduleId: number) =>
    http(`/api/modules/${moduleId}/publish`, {
      method: "PATCH",
    }),
  unpublishModule: (moduleId: number) =>
    http(`/api/modules/${moduleId}/unpublish`, {
      method: "PATCH",
    }),
  updateModule: (
    moduleId: number,
    payload: { title?: string; description?: string | null; position?: number },
  ) =>
    http(`/api/modules/${moduleId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteModule: (moduleId: number) =>
    http(`/api/modules/${moduleId}`, {
      method: "DELETE",
    }),
  // Bulk-reorder every module in a course. `orderedIds` is the full ordered
  // set of module ids; the server reassigns positions 0..n-1 atomically.
  reorderModules: (courseId: number, orderedIds: number[]) =>
    http(`/api/courses/${courseId}/modules/order`, {
      method: "PUT",
      body: JSON.stringify({ orderedIds }),
    }),
  lessonsForModule: (moduleId: number, params?: ListParams) =>
    decode(
      http(
        `/api/modules/${moduleId}/lessons${pageQuery({ page: 1, pageSize: TREE_PAGE_SIZE, ...params })}`,
      ),
      paginatedSchema(lessonSchema),
    ),
  createLesson: (
    moduleId: number,
    payload: { title: string; contentMd?: string; position?: number },
  ) =>
    http(`/api/modules/${moduleId}/lessons`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  publishLesson: (lessonId: number) =>
    http(`/api/lessons/${lessonId}/publish`, {
      method: "PATCH",
    }),
  unpublishLesson: (lessonId: number) =>
    http(`/api/lessons/${lessonId}/unpublish`, {
      method: "PATCH",
    }),
  updateLesson: (
    lessonId: number,
    payload: { title?: string; contentMd?: string | null; position?: number },
  ) =>
    http(`/api/lessons/${lessonId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteLesson: (lessonId: number) =>
    http(`/api/lessons/${lessonId}`, {
      method: "DELETE",
    }),
  // Bulk-reorder every lesson within a module (see reorderModules).
  reorderLessons: (moduleId: number, orderedIds: number[]) =>
    http(`/api/modules/${moduleId}/lessons/order`, {
      method: "PUT",
      body: JSON.stringify({ orderedIds }),
    }),
  lessonById: (lessonId: number) => http(`/api/lessons/${lessonId}`) as Promise<Lesson>,
  /**
   * Module/course ancestry + ordinals for lesson shell crumbs (#1334).
   * Fetched after paint — not awaited in the lesson clientLoader.
   */
  lessonBreadcrumb: (lessonId: number) =>
    http(`/api/lessons/${lessonId}/breadcrumb`) as Promise<LessonBreadcrumb>,
  activitiesForLesson: (lessonId: number, params?: ListParams) =>
    decode(
      http(
        `/api/lessons/${lessonId}/activities${pageQuery({ page: 1, pageSize: TREE_PAGE_SIZE, ...params })}`,
      ),
      paginatedSchema(activitySchema),
    ),
  createActivity: (
    lessonId: number,
    payload: {
      title?: string;
      question: string;
      type?: "MCQ" | "SHORT_TEXT";
      options?: { choices?: string[] } | null;
      answer?: any;
      hints?: string[];
      instructionsMd?: string;
      promptTemplateId?: number | null;
      customPrompt?: string | null;
      customPromptTitle?: string | null;
      mainTopicId: string | number;
      secondaryTopicIds?: (string | number)[];
      enableTeachMode?: boolean;
      enableGuideMode?: boolean;
      enableCustomMode?: boolean;
    },
  ) =>
    http(`/api/lessons/${lessonId}/activities`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateActivity: (activityId: number, payload: ActivityUpdateBody) => {
    const body: WireBody = {};
    Object.assign(body, payload);
    if (Object.prototype.hasOwnProperty.call(payload, "options")) {
      const value = payload.options;
      if (value === null) {
        body.options = null;
      } else if (Array.isArray(value)) {
        body.options = value;
      } else if (value && Array.isArray(value.choices)) {
        body.options = value.choices;
      }
    }
    return http(`/api/activities/${activityId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },
  deleteActivity: (activityId: number) =>
    http(`/api/activities/${activityId}`, {
      method: "DELETE",
    }),
  // Bulk-reorder every activity within a lesson (see reorderModules).
  reorderActivities: (lessonId: number, orderedIds: number[]) =>
    http(`/api/lessons/${lessonId}/activities/order`, {
      method: "PUT",
      body: JSON.stringify({ orderedIds }),
    }),
  topicsForCourse: (courseId: number, params?: ListParams) =>
    decode(
      http(
        `/api/courses/${courseId}/topics${pageQuery({ page: 1, pageSize: TOPIC_PAGE_SIZE, ...params })}`,
      ),
      paginatedSchema(topicSchema),
    ),
  createTopic: (courseId: number, payload: { name: string }) =>
    http(`/api/courses/${courseId}/topics`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  /**
   * Shared bank questions available to build an activity from (Task 2). The
   * server already excludes long-answer AND select-all-that-apply questions
   * (an activity's single `correctIndex` cannot represent either), so this
   * must not re-filter. The server fills the page across as many Core pages as
   * it needs, so a full run of unusable questions no longer yields an empty
   * result. `hasMore` is surfaced as-is, never turned into a count, and
   * `nextOffset` is the offset to resume from — see the route docblock.
   */
  listBankQuestions: (
    courseId: number,
    params: { topicId?: string; limit?: number; offset?: number } = {},
  ): Promise<{ questions: BankQuestion[]; hasMore: boolean; nextOffset?: number }> => {
    const query = new URLSearchParams();
    if (params.topicId) query.set("topicId", params.topicId);
    if (params.limit) query.set("limit", String(params.limit));
    if (params.offset) query.set("offset", String(params.offset));
    const suffix = query.toString() ? `?${query}` : "";
    return http(`/api/courses/${courseId}/bank-questions${suffix}`).then((data) => ({
      questions: (data.questions ?? []) as BankQuestion[],
      hasMore: data.hasMore === true,
      nextOffset: typeof data.nextOffset === "number" ? data.nextOffset : undefined,
    }));
  },
  submitAnswer: (activityId: number, payload: any) =>
    decode(
      http(`/api/questions/${activityId}/answer`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
      activityAnswerResultSchema,
    ),
  submitActivityFeedback: (activityId: number, payload: { rating: number; note?: string }) =>
    decode(
      http(`/api/activities/${activityId}/feedback`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
      activityFeedbackResultSchema,
    ),
  sendTeachMessage: (
    activityId: number,
    params: {
      knowledgeLevel: string;
      topicId?: string | number;
      message: string;
      modelId: string;
      apiKey?: string;
      // #1645: the full held-key map (provider -> secret), forwarded so Core's
      // fleet-down fallback can switch to a BYOK provider the student holds but
      // didn't select. `apiKey` remains the selected model's key.
      apiKeys?: Record<string, string>;
      chatId?: string | null;
      messageId?: string;
    },
    signal?: AbortSignal,
  ) =>
    http(`/api/activities/${activityId}/teach`, {
      method: "POST",
      body: JSON.stringify(withWireTopicId(params)),
      signal,
      timeoutMs: CHAT_TIMEOUT_MS,
    }),
  sendGuideMessage: (
    activityId: number,
    params: {
      knowledgeLevel: string;
      message: string;
      studentAnswer?: string | number | null;
      modelId: string;
      apiKey?: string;
      apiKeys?: Record<string, string>;
      chatId?: string | null;
      messageId?: string;
    },
    signal?: AbortSignal,
  ) =>
    http(`/api/activities/${activityId}/guide`, {
      method: "POST",
      body: JSON.stringify(params),
      signal,
      timeoutMs: CHAT_TIMEOUT_MS,
    }),
  sendCustomMessage: (
    activityId: number,
    params: {
      knowledgeLevel: string;
      topicId?: string | number;
      message: string;
      studentAnswer?: string | number | null;
      modelId: string;
      apiKey?: string;
      apiKeys?: Record<string, string>;
      chatId?: string | null;
      messageId?: string;
    },
    signal?: AbortSignal,
  ) =>
    http(`/api/activities/${activityId}/custom`, {
      method: "POST",
      body: JSON.stringify(withWireTopicId(params)),
      signal,
      timeoutMs: CHAT_TIMEOUT_MS,
    }),
  listChatSessions: (activityId: number) =>
    decode(http(`/api/activities/${activityId}/chat-sessions`), z.array(chatSessionRowSchema)),
  getChatMessages: (activityId: number, chatId: string) =>
    decode(
      http(`/api/activities/${activityId}/chat-sessions/${chatId}/messages`),
      chatMessagesSchema,
    ),
  listAiModels: () => decode(http("/api/ai-models"), z.array(aiModelSchema)),
  validateApiKey: (provider: string, apiKey: string) =>
    decode(
      http("/api/ai-models/validate-key", {
        method: "POST",
        body: JSON.stringify({ provider, apiKey }),
      }),
      apiKeyValidationSchema,
    ),
  getUserProviderSettings: () =>
    http("/api/provider-settings") as Promise<UserProviderSettingStatus[]>,
  saveUserProviderSetting: (payload: {
    providerName: string;
    isEnabled: boolean;
    apiKey?: string;
    baseUrl?: string;
  }) =>
    http("/api/provider-settings", {
      method: "POST",
      body: JSON.stringify(payload),
    }) as Promise<void>,
  deleteUserProviderSetting: (providerName: string) =>
    http(`/api/provider-settings?providerName=${encodeURIComponent(providerName)}`, {
      method: "DELETE",
    }) as Promise<void>,
  getEduAiApiKeyStatus: () =>
    decode(http("/api/admin/settings/eduai-api-key"), eduAiApiKeyStatusSchema),
  getAdminAiModelPolicy: () =>
    decode(http("/api/admin/settings/ai-model-policy"), adminAiModelPolicyResponseSchema),
  setAdminAiModelPolicy: (payload: AdminAiModelPolicy) =>
    decode(
      http("/api/admin/settings/ai-model-policy", {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
      adminAiModelPolicyResponseSchema,
    ),
  /**
   * Paged platform users from Core (#1041). Returns the envelope, not an array —
   * `stats` carries the platform-wide totals the dashboard needs.
   */
  listAdminUsers: (params: { page?: number; pageSize?: number } = {}) =>
    decode(
      http(`/api/admin/users?page=${params.page ?? 1}&pageSize=${params.pageSize ?? 25}`),
      adminUserPageSchema,
    ),
  listAdminCourses: (params?: { page?: number; pageSize?: number }) =>
    decode(
      http(
        `/api/admin/courses${pageQuery({ page: 1, pageSize: COURSE_LIST_PAGE_SIZE, ...params })}`,
      ),
      paginatedSchema(courseSchema),
    ),
  /**
   * `availableStudents` is one page of Core's STUDENT list (#1041) — pass
   * `search`/`page` to reach students past the first page.
   */
  getAdminCourseEnrollments: (
    courseId: number,
    params: { search?: string; page?: number; pageSize?: number } = {},
  ) => {
    const query = new URLSearchParams();
    if (params.search) query.set("search", params.search);
    if (params.page) query.set("page", String(params.page));
    if (params.pageSize) query.set("pageSize", String(params.pageSize));
    const suffix = query.size > 0 ? `?${query}` : "";
    return decode(
      http(`/api/admin/courses/${courseId}/enrollments${suffix}`),
      adminEnrollmentDataSchema,
    );
  },
  removeStudentFromCourse: (courseId: number, userId: string) =>
    decode(
      http(`/api/admin/courses/${courseId}/enrollments/${userId}`, {
        method: "DELETE",
      }),
      okSchema,
    ),
  updateEnrollmentRole: (courseId: number, userId: string, role: EnrollmentRole) =>
    decode(
      http(`/api/admin/courses/${courseId}/enrollments/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
      okWithRoleSchema,
    ),
  courseSubmissions: (
    courseId: number,
    params?: { activityId?: number; studentId?: string; take?: number; skip?: number },
  ) => {
    const search = new URLSearchParams();
    if (params?.activityId != null) search.set("activityId", String(params.activityId));
    if (params?.studentId) search.set("studentId", params.studentId);
    if (params?.take != null) search.set("take", String(params.take));
    if (params?.skip != null) search.set("skip", String(params.skip));
    const qs = search.toString();
    return decode(
      http(`/api/courses/${courseId}/submissions${qs ? `?${qs}` : ""}`),
      z.array(submissionRowSchema),
    );
  },
  listCourseFeedback: (
    courseId: number,
    params?: { activityId?: number; studentId?: string; take?: number; skip?: number },
  ) => {
    const search = new URLSearchParams();
    if (params?.activityId != null) search.set("activityId", String(params.activityId));
    if (params?.studentId) search.set("studentId", params.studentId);
    if (params?.take != null) search.set("take", String(params.take));
    if (params?.skip != null) search.set("skip", String(params.skip));
    const qs = search.toString();
    return decode(
      http(`/api/courses/${courseId}/feedback${qs ? `?${qs}` : ""}`),
      z.array(activityFeedbackRowSchema),
    );
  },
  courseStudentMetrics: (courseId: number) =>
    decode(http(`/api/courses/${courseId}/student-metrics`), z.array(studentMetricRowSchema)),
  courseAnalytics: (courseId: number) =>
    decode(http(`/api/courses/${courseId}/analytics`), z.array(activityAnalyticsRowSchema)),
  activitySubmissions: (activityId: number) =>
    decode(http(`/api/activities/${activityId}/submissions`), z.array(submissionRowSchema)),
  listActivityFeedback: (activityId: number) =>
    decode(http(`/api/activities/${activityId}/feedback`), z.array(activityFeedbackRowSchema)),
  mySubmissions: () => decode(http("/api/me/submissions"), z.array(submissionRowSchema)),
  myFeedback: () => decode(http("/api/me/feedback"), z.array(activityFeedbackRowSchema)),
  submitBugReport: (payload: BugReportCreatePayload) =>
    decode(
      http("/api/bug-reports", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
      okSchema,
    ),
  listAdminBugReports: () =>
    decode(http("/api/admin/bug-reports"), z.array(adminBugReportRowSchema)),
  getAdminBugReport: (reportId: string) =>
    decode(http(`/api/admin/bug-reports/${reportId}`), adminBugReportRowSchema),
  updateAdminBugReportStatus: (reportId: string, payload: { status: BugReportStatus }) =>
    decode(
      http(`/api/admin/bug-reports/${reportId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
      bugReportStatusUpdatedSchema,
    ),
  setEduAiApiKey: (apiKey: string) =>
    decode(
      http("/api/admin/settings/eduai-api-key", {
        method: "PUT",
        body: JSON.stringify({ apiKey }),
      }),
      eduAiApiKeyStatusSchema,
    ),
  clearEduAiApiKey: () =>
    decode(
      http("/api/admin/settings/eduai-api-key", {
        method: "DELETE",
      }),
      eduAiApiKeyStatusSchema,
    ),
  listPrompts: () => http("/api/prompts"),
  listSuggestedPrompts: () =>
    decode(http("/api/suggested-prompts"), z.array(suggestedPromptSchema)),
  createPrompt: (payload: {
    name: string;
    systemPrompt: string;
    temperature?: number | null;
    topP?: number | null;
  }) =>
    http("/api/prompts", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  gradeSubmission: (activityId: number, submissionId: number, body: SubmissionGradeBody) =>
    decode(
      http(`/api/activities/${activityId}/submissions/${submissionId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
      gradedSubmissionSchema,
    ),
  duplicateActivity: (activityId: number) =>
    decode(
      http(`/api/activities/${activityId}/duplicate`, {
        method: "POST",
      }),
      activitySchema,
    ),
  importActivity: (lessonId: number, sourceActivityId: number) =>
    decode(
      http(`/api/lessons/${lessonId}/activities/import`, {
        method: "POST",
        body: JSON.stringify({ sourceActivityId }),
      }),
      activitySchema,
    ),
  listImportableActivities: (
    courseId?: number,
    params?: ListParams & { excludeLessonId?: number },
  ) => {
    const qs = new URLSearchParams();
    if (courseId != null) qs.set("courseId", String(courseId));
    if (params?.excludeLessonId != null) {
      qs.set("excludeLessonId", String(params.excludeLessonId));
    }
    // Group A endpoint — server requires page/pageSize. #1207: this endpoint's
    // scope is every course the caller manages, so one page is a slice of the
    // instructor's whole activity corpus. `search` is what makes the rest
    // reachable, and it is applied server-side — the picker must not filter the
    // returned page again.
    qs.set("page", String(params?.page ?? 1));
    qs.set("pageSize", String(params?.pageSize ?? IMPORT_PICKER_PAGE_SIZE));
    if (params?.search != null && params.search.trim() !== "") {
      qs.set("search", params.search.trim());
    }
    return decode(
      http(`/api/activities/importable?${qs.toString()}`),
      paginatedSchema(importableActivitySchema),
    );
  },
  /**
   * Move one module/lesson/activity to an absolute 0-based ordinal within its
   * siblings (#1207). Unlike the bulk `reorder*` calls this needs no
   * client-side copy of the full ordered list, so it works from any page: a
   * drag computes `(page - 1) * pageSize + dropIndex`, and "Move to position…"
   * sends the typed ordinal directly.
   */
  moveModuleToPosition: (moduleId: number, position: number) =>
    decode(
      http(`/api/modules/${moduleId}/position`, {
        method: "PATCH",
        body: JSON.stringify({ position }),
      }),
      moduleMoveSchema,
    ),
  moveLessonToPosition: (lessonId: number, position: number) =>
    decode(
      http(`/api/lessons/${lessonId}/position`, {
        method: "PATCH",
        body: JSON.stringify({ position }),
      }),
      lessonMoveSchema,
    ),
  moveActivityToPosition: (activityId: number, position: number) =>
    decode(
      http(`/api/activities/${activityId}/position`, {
        method: "PATCH",
        body: JSON.stringify({ position }),
      }),
      activityMoveSchema,
    ),
  /**
   * Structural position of a lesson in its tree (#1207). Replaces deriving the
   * "3.2" breadcrumb by `findIndex` over full sibling lists — that read was
   * wrong the moment a tree exceeded one page.
   */
  lessonContext: (lessonId: number) =>
    decode(http(`/api/lessons/${lessonId}/context`), lessonContextSchema),
  /**
   * Structural position of a module in its course (#1207) — the ordinal chip on
   * the instructor module view. Replaces a `findIndex` over the full sibling
   * module list, which scored -1 for any module past the first page.
   */
  moduleContext: (moduleId: number) =>
    decode(http(`/api/modules/${moduleId}/context`), moduleContextSchema),
  dashboardStats: () => decode(http("/api/me/dashboard-stats"), dashboardStatsSchema),
  adminAiTraces: (params?: { unit?: string; courseId?: string | number; limit?: number }) => {
    const search = new URLSearchParams();
    if (params?.unit) search.set("unit", params.unit);
    if (params?.courseId != null) search.set("courseId", String(params.courseId));
    if (params?.limit != null) search.set("limit", String(params.limit));
    const qs = search.toString();
    return decode(http(`/api/admin/ai-traces${qs ? `?${qs}` : ""}`), z.array(aiTraceRowSchema));
  },
  /**
   * Proxies sign-out through the AT backend (server-to-server to Core) so the
   * browser avoids CORS restrictions on Core's sign-out endpoint.
   * Bypasses `http()` to avoid the 401-redirect loop that would fire if the
   * session is already stale by the time logout is called.
   */
  logout: async () => {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/api/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      throw new ApiNetworkError("Logout service unreachable");
    }
    if (!response.ok) {
      let message = `Logout failed: ${response.status}`;
      try {
        const payload = z.object({ error: z.string() }).safeParse(await response.json());
        if (payload.success && payload.data.error.trim()) {
          message = payload.data.error;
        }
      } catch {
        // A status-bearing error is still actionable when the body is empty or malformed.
      }
      if (response.status === 504) throw new ApiTimeoutError(message);
      throw new Error(message);
    }
    return { ok: true } as const;
  },
};

export default api;
