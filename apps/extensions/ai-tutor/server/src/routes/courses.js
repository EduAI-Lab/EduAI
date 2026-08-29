/**
 * @file Course offering listing, creation, EduAI import, content cloning, and
 *       publish/unpublish workflow.
 *
 * Responsibility: Owns the CourseOffering top-level lifecycle: instructor
 *   creates/imports/clones courses; students see only published ones with
 *   their progress.
 * Callers: Mounted under `/api`; consumed by the home, instructor, and student
 *   list pages plus the course-import dialogs.
 * Gotchas:
 *   - Listing is role-divergent: INSTRUCTOR sees all assigned courses regardless
 *     of publish state; STUDENT only sees published courses they're enrolled
 *     in, with progress computed per course (N+1 by design — kept here, may
 *     warrant batching if course counts grow). The publish gate itself is
 *     read-through from Core (`resolveIsPublished`, #1072 step 2 / #819) —
 *     one batched `GET /api/courses` per request, not per-course.
 *   - Unified contract (#1072): field/publish resolution uses ONE service-key
 *     catalog fetch (`resolveCoreCourseCatalog`) — complete regardless of the
 *     caller's Core enrollment (AT and Core enrollment are independent
 *     tracks, so the cookie-scoped list is not a valid field source). The
 *     cookie-scoped list is only fetched inside the throttled fire-and-forget
 *     auto-import mirror (`runCoreMirror`), which consumes
 *     `callerEnrollmentRole` — authorization context. The list response
 *     itself performs exactly ONE Core call (the catalog).
 *   - Course-owned fields (title/description/department/dates/isPublished/
 *     term/year/aiInstructions) are read-through from Core via
 *     `services/courseResolver.js` + `mapCourseOffering`; the local
 *     `CourseOffering` row is a pure anchor (#1072 step 4 — id,
 *     `coreOfferingId`, timestamps only, no Core-owned columns). A Core
 *     outage degrades those fields to `null`/`false` rather than a stale
 *     local copy. See `courseResolver.js` for the fail-soft contract.
 *   - UNIT_ADMIN department scoping (`isUnitAdminForCourse`/`isCourseAdmin`
 *     in `middleware/auth.js`) also resolves `department` live from Core —
 *     there is no local column to filter/read anymore.
 *   - Importing from EduAI fans out into parallel topic + enrollment sync via
 *     `Promise.allSettled` so a partial upstream failure doesn't roll back the
 *     import itself; failures are logged.
 *   - `GET /courses/:courseId` live-syncs student/TA enrollments from Core
 *     before its membership check (#1065). A live roster failure fails closed
 *     for learners; only staff roles may use the bounded local mirror
 *     fallback. `POST /courses/:courseId/sync-enrollments` is now dead code
 *     kept for API compatibility, same treatment as the old `POST
 *     .../topics/sync`.
 *   - Publish has no cascading; unpublish CASCADES to all child modules and
 *     lessons in a transaction so a student can never reach orphaned content.
 *   - `POST /courses` accepts an optional `sourceCourseId` to deep-clone
 *     content from another course the same instructor owns.
 * Related: services/eduaiClient.js, services/topicSync.js,
 *   services/enrollmentSync.js, services/courseCloning.js,
 *   services/progressCalculation.js
 */

import express from "express";
import { prisma } from "../config/database.js";
import { requireRole, isCourseAdmin } from "../middleware/auth.js";
import {
  mapCourseOffering,
  mapCourseOfferingAfterPublishWrite,
  mapProgressData,
} from "../utils/mappers.js";
import {
  parsePaginationParams,
  parseSearchParam,
  parseFilterParam,
  paginated,
  PaginationError,
} from "../utils/pagination.js";
import {
  COURSE_PROGRESS_VALUES,
  COURSE_STATUS_VALUES,
  coreFacetWhere,
  coreFacets,
} from "../utils/courseSearch.js";
import { calculateCourseProgressBatch, progressBucket } from "../services/progressCalculation.js";
import {
  CourseMutationError,
  importCourseContentForUser,
  publishCourseForUser,
  unpublishCourseForUser,
} from "../services/courseManagement.js";
import { isSupportedCourseRole, resolveCourseAccess } from "../services/courseAccess.js";
import {
  findEduAiCourseById,
  listCoreAdminUsers,
  listEduAiCourseEnrollmentsServiceKey,
  listEduAiCourses,
} from "../services/eduaiClient.js";
import {
  indexCoreCoursesById,
  resolveCoreCourseById,
  resolveCoreCourseCatalog,
  resolveCoreCourseList,
  resolveIsPublished,
} from "../services/courseResolver.js";
import { mapEduAiServiceKeyError } from "../services/eduaiServiceKeyErrors.js";
import { getEduAiCookieForRequest } from "../services/eduaiAuth.js";
import {
  authorizeLiveStudentEnrollment,
  AUTO_SYNC_TIMEOUT_MS,
  AUTO_SYNC_TTL_MS,
  LIVE_ENROLLMENT_AUTH_UNAVAILABLE_CODE,
  LIVE_ENROLLMENT_AUTH_UNAVAILABLE_MESSAGE,
  syncCourseEnrollments,
} from "../services/enrollmentSync.js";
import {
  ensureOfferingAnchors,
  importExternalCourseForUser,
} from "../services/importTaughtCoursesService.js";
import { listAdminBugReports } from "../services/bugReports.js";
import { listBankQuestions } from "../services/bankQuestions.js";
import { logSafeError, sendSafeError } from "../utils/safeErrors.js";
import { gateCourseById } from "../middleware/liveCoursePrincipal.js";
import {
  authorizeLiveCoursePrincipal,
  isAllowedLiveCourseStaffPrincipal,
  LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
  LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
} from "../services/liveCoursePrincipal.js";
import {
  CourseContentImportSchema,
  ExternalCourseImportSchema,
} from "../../../shared/schemas/mutations.js";

const router = express.Router();

router.use("/courses/:courseId", gateCourseById());

const COURSE_COLLECTION_AUTH_UNAVAILABLE_CODE = "COURSE_COLLECTION_AUTH_UNAVAILABLE";
const COURSE_COLLECTION_AUTH_UNAVAILABLE_MESSAGE = "Course collection authorization unavailable";

async function resolveCourseStaffMembership(course, authUser) {
  const principal = await authorizeLiveCoursePrincipal(course, authUser);
  const liveTa = principal.state === "allowed" && principal.role === "TA";
  return {
    principal,
    hasAdminAccess: isAllowedLiveCourseStaffPrincipal(principal),
    isTa: liveTa,
  };
}

async function resolveCourseCollectionContext(req, res) {
  const authUser = req.user;
  const needsCallerRoles = ["INSTRUCTOR", "STUDENT", "TA"].includes(authUser.role);
  const cookie = getEduAiCookieForRequest(req);
  const [catalog, caller] = await Promise.all([
    resolveCoreCourseCatalog(),
    needsCallerRoles
      ? resolveCoreCourseList({ cookie })
      : Promise.resolve({ courses: [], coreUnavailable: false }),
  ]);

  if (authUser.role !== "ADMIN" && (catalog.coreUnavailable || caller.coreUnavailable)) {
    res.status(503).json({
      error: COURSE_COLLECTION_AUTH_UNAVAILABLE_MESSAGE,
      code: COURSE_COLLECTION_AUTH_UNAVAILABLE_CODE,
    });
    return null;
  }

  if (catalog.coreUnavailable) res.set("X-Core-Status", "unavailable");
  return {
    catalogCourses: catalog.courses,
    callerCourses: caller.courses,
    coreUnavailable: catalog.coreUnavailable,
  };
}

async function ensureAuthorizedCollectionAnchors(authUser, catalogCourses, callerCourses) {
  let coreIds = callerCourses.map((course) => course?.id).filter(Boolean);
  if (authUser.role === "UNIT_ADMIN") {
    const units = new Set(Array.isArray(authUser.authorizedUnits) ? authUser.authorizedUnits : []);
    coreIds = catalogCourses
      .filter((course) => course?.department && units.has(course.department))
      .map((course) => course.id);
  }
  if (coreIds.length > 0) await ensureOfferingAnchors(coreIds);
}

/**
 * Combine Prisma where-fragments with AND, dropping the absent ones.
 *
 * Returns `undefined` for an all-empty list (an unscoped query — only ADMIN with
 * no filters reaches that) and the bare fragment for a single entry, so the
 * common cases produce exactly the query they did before #1208 added filters.
 * AND-wrapping matters for the UNIT_ADMIN branch in particular: its `where` is an
 * `OR`, and merging a filter into that object would widen the result instead of
 * narrowing it.
 */
function andWhere(fragments) {
  const parts = fragments.filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return { AND: parts };
}

/**
 * Pull the MCQ option labels out of a freeform `Activity.config`. Mirrors the
 * `options` normalization in `mapActivity` — accepts the modern
 * `{ options: { choices: [] } }` shape and the legacy bare-array form. Returns
 * `null` when the activity carries no choices (e.g. short-answer questions).
 */
function extractChoices(config) {
  if (!config || typeof config !== "object") return null;
  const { options } = config;
  if (options == null) return null;
  if (Array.isArray(options)) return options;
  if (Array.isArray(options.choices)) return options.choices;
  return null;
}

function respondEduAiUpstreamError(res, error, fallbackMessage) {
  const mapped = mapEduAiServiceKeyError(error);
  if (mapped) {
    return res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
  }
  logSafeError("[courses] EduAI upstream request failed", error);
  const status = Number.isInteger(error?.status) ? error.status : 502;
  return sendSafeError(res, error, fallbackMessage, { status });
}

/**
 * GET /eduai/courses — list importable EduAI courses for the instructor.
 *
 * Auth: INSTRUCTOR.
 * Returns: EduAI course descriptors minus any already imported by this
 *   instructor (de-duped via local `coreOfferingId`).
 *
 * Why: filtering by THIS instructor (not globally) lets multiple instructors
 * import the same EduAI course independently into their own offerings.
 */
router.get(
  "/eduai/courses",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    try {
      // #578: list the caller's Core-scoped courses using their session cookie
      // (the service key would return the full catalog). Mirrors the import path.
      // #1041: Core pages this endpoint, and the already-imported filter below
      // needs the caller's complete set, so walk every page.
      const courses = await listEduAiCourses({ cookie: req.headers.cookie, all: true });

      // Exclude any Core course already mirrored into AI Tutor. coreOfferingId is
      // required + @unique (#1072 step 4 — every row is Core-linked, no filter
      // needed), so a hit there means the course is already in the system.
      const imported = await prisma.courseOffering.findMany({
        select: { coreOfferingId: true },
      });

      const importedIds = new Set(imported.map((row) => row.coreOfferingId).filter(Boolean));
      const filtered = Array.isArray(courses)
        ? courses.filter((c) => c && typeof c.id === "string" && !importedIds.has(c.id))
        : [];

      res.json(filtered);
    } catch (error) {
      logSafeError("[eduai] Failed to list courses", error);
      return respondEduAiUpstreamError(res, error, "Unable to fetch EduAI courses");
    }
  },
);

/**
 * GET /courses — list courses for the current user.
 *
 * Auth: INSTRUCTOR or STUDENT.
 * Returns: INSTRUCTOR → all instructor-assigned courses (no progress);
 *   STUDENT → published enrolled courses each with `progress`.
 * Query: `page`/`pageSize` (required, #1043), plus the optional #1208 filters —
 *   `search` (free text over title + code), repeatable `term` (`W1::2026`),
 *   repeatable `status` (published|draft), repeatable `progress`
 *   (not-started|in-progress|completed).
 *
 * Why: the two roles want fundamentally different shapes, so progress
 * computation is skipped entirely for instructors to keep their dashboard fast.
 *
 * Gotchas (#1208):
 *   - `search`/`term`/`status` CANNOT be Prisma predicates: title, code, term,
 *     year and isPublished are Core-owned read-throughs with no local column
 *     (#1072 step 4). They are matched against the catalog this request already
 *     fetched and pushed down as `coreOfferingId IN (...)` — see
 *     utils/courseSearch.js. Because `count` and `findMany` share that `where`,
 *     `total` is the filtered total and the pager stays honest.
 *   - Consequently, when Core is unavailable the catalog is empty and every one
 *     of those filters resolves to `{ in: [] }` → zero rows. That is the same
 *     fail-closed stance the publish gate takes; `X-Core-Status: unavailable`
 *     lets the client say "search unavailable" instead of "no matches".
 *   - `progress` is the one LOCAL dimension (Activity/Submission). It is scoped
 *     per caller, so it is ignored — not rejected — for roles whose rows carry
 *     no progress, keeping a bookmarked URL from 400ing after a role change.
 *   - Filters never widen access: each is AND-ed onto the role `where` from
 *     services/courseAccess.js, so e.g. `?status=draft` as a STUDENT returns
 *     nothing rather than exposing an unpublished course.
 */
router.get("/courses", async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: "Authentication required" });
  if (!isSupportedCourseRole(authUser.role)) {
    return res.status(403).json({ error: "Role is not supported in AI Tutor" });
  }

  try {
    // #1043: unbounded list — require explicit paging (Group A contract,
    // mirrors #1041). One envelope shape across every role branch below.
    const pageParams = parsePaginationParams(req);

    // #1208: parse before any I/O so a malformed filter 400s without hitting
    // Core or the database.
    const search = parseSearchParam(req);
    const terms = parseFilterParam(req, "term");
    const statuses = parseFilterParam(req, "status", { allowed: COURSE_STATUS_VALUES });
    const progressBuckets = parseFilterParam(req, "progress", { allowed: COURSE_PROGRESS_VALUES });

    // Unified extension course-fetch contract (#1072): course FIELD truth
    // comes from ONE batched service-key catalog fetch — never the
    // cookie-scoped list, whose contents depend on the caller's Core
    // enrollment (AT and Core enrollment are independent tracks). The
    // cookie-scoped list is fetched separately below, ONLY in branches that
    // run the auto-import mirrors (they consume `callerEnrollmentRole` —
    // authorization context, not fields). At most 2 Core calls per request.
    // On catalog failure this degrades to an empty Core map (fields null,
    // publish gates fail closed) plus an `X-Core-Status` header the client
    // can render (see #1066's topic fail-soft pattern) — never a hard error.
    const collectionContext = await resolveCourseCollectionContext(req, res);
    if (!collectionContext) return;
    const { catalogCourses, callerCourses, coreUnavailable } = collectionContext;
    const coreCoursesById = indexCoreCoursesById(catalogCourses);
    if (coreUnavailable) {
      res.set("X-Core-Status", "unavailable");
    }
    const withCore = (offering) =>
      mapCourseOffering(offering, coreCoursesById.get(offering.coreOfferingId));

    // #1043: the student/TA publish gate was a post-query `.filter(isCorePublished)`,
    // which makes skip/take and `total` lie (a page could be mostly unpublished).
    // resolveIsPublished is purely `catalog.get(coreOfferingId)?.isPublished === true`
    // (no local column since #1072), and the catalog is already fully page-walked
    // above — so we can push the exact same gate into the SQL `where` as an id set.
    // Fail-closed is preserved: on `coreUnavailable` this list is empty, so the
    // filter yields `{ in: [] }` → no rows, matching the old behaviour.
    const publishedCoreIds = catalogCourses.filter((c) => c?.isPublished === true).map((c) => c.id);

    await ensureAuthorizedCollectionAnchors(authUser, catalogCourses, callerCourses);

    // #1208: role → visibility lives in services/courseAccess.js so this
    // endpoint and GET /courses/facets cannot disagree about what the caller
    // may see. A facet value the list can never return would offer the user a
    // filter that always yields nothing.
    const access = await resolveCourseAccess(authUser, {
      catalogCourses,
      publishedCoreIds,
      callerCourses,
    });

    if (access.kind === "admin") {
      // Platform admins see Core's full course catalog (#1074), not just
      // whatever happened to already have a local anchor row — the old
      // enrollment-driven mirror never ran for admins (no enrollments of
      // their own), so it silently showed a stale/incomplete subset.
      // Create-on-open (#1072 step 3): ensure every Core course has a local
      // anchor *before* listing, in one batched read + insert (never a
      // per-course loop) — this is what lets the response link to a real,
      // stable local id for a course no instructor has ever logged in to
      // auto-import. Fields are read-through from Core above. The anchor id
      // set comes from the service-key catalog — identical to what Core's
      // admin-to-all cookie branch used to return, without needing a cookie
      // call in this branch at all.
      if (!coreUnavailable && catalogCourses.length > 0) {
        await ensureOfferingAnchors(catalogCourses.map((c) => c.id));
      }
    }

    // The caller holds no enrollments at all — no query can return anything.
    if (access.isEmpty) {
      return res.json(paginated([], 0, pageParams));
    }

    // #1208: catalog-side dimensions collapse to one id-set predicate, AND-ed
    // onto the role `where` so a filter can only ever narrow, never widen.
    const facetWhere = coreFacetWhere(catalogCourses, { search, terms, statuses });

    // #1208: `progress` is local, so it needs the caller's whole accessible set
    // bucketed before paging. Narrow by the catalog filters first so the batch
    // runs over as few courses as possible, and skip it entirely for roles whose
    // rows carry no progress (a stray param on a bookmarked URL is ignored, not
    // a 400 — see the docblock).
    let progressWhere = null;
    if (progressBuckets.length > 0 && access.hasProgress) {
      const candidates = await prisma.courseOffering.findMany({
        where: andWhere([access.where, facetWhere]),
        select: { id: true, coreOfferingId: true },
      });
      // In the TA union, TA-held courses are returned without progress, so they
      // belong to no bucket and any progress filter excludes them.
      const scopedIds = candidates
        .map((c) => c.id)
        .filter((id) => {
          if (access.kind !== "taUnion") return true;
          const course = candidates.find((candidate) => candidate.id === id);
          return !access.taCoreIdSet.has(course?.coreOfferingId);
        });
      const bucketed = await calculateCourseProgressBatch(scopedIds, authUser.id);
      progressWhere = {
        id: {
          in: scopedIds.filter((id) => progressBuckets.includes(progressBucket(bucketed.get(id)))),
        },
      };
    }

    const listWhere = andWhere([access.where, facetWhere, progressWhere]);

    const [total, courses] = await prisma.$transaction([
      prisma.courseOffering.count({ where: listWhere }),
      prisma.courseOffering.findMany({
        where: listWhere,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: pageParams.skip,
        take: pageParams.take,
      }),
    ]);

    // Progress is attached only to rows the caller holds as a STUDENT: the
    // instructor/admin shapes carry none (keeps their dashboard fast), and in
    // the TA union a course held under both roles resolves to the TA shape.
    // #1208: one batched call for the whole page — this used to be a
    // per-course `calculateCourseProgress` await (2 queries each).
    const progressIds = courses
      .filter(
        (course) =>
          access.kind === "student" ||
          (access.kind === "taUnion" && !access.taCoreIdSet.has(course.coreOfferingId)),
      )
      .map((course) => course.id);
    const progressById = await calculateCourseProgressBatch(progressIds, authUser.id);

    const rows = courses.map((course) => {
      const progress = progressById.get(course.id);
      if (!progress) return withCore(course);
      return { ...withCore(course), progress: mapProgressData(progress) };
    });

    res.json(paginated(rows, total, pageParams));
  } catch (e) {
    if (e instanceof PaginationError) {
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    sendSafeError(res, e, "Internal server error");
  }
});

/**
 * GET /courses/facets — filter options for the course list (#1208).
 *
 * Auth: any supported course role.
 * Returns: `{ terms: string[], statuses: string[], progress: string[] }` — raw
 *   filter values (`"W1::2026"`, `"published"`, `"not-started"`); the client
 *   labels them, see below.
 *
 * Why a sibling endpoint rather than a `facets` key on the list response: the
 * `{ data, total, page, pageSize }` envelope is the shared pagination contract
 * (#1043, mirroring Core's #1041) and widening it would ripple into every other
 * paged reader. Facets also change rarely, so the client fetches them once per
 * mount instead of on every keystroke.
 *
 * Why it exists at all: dropdown options used to be derived from the loaded page,
 * so a term that only appears on page 3 was never offered as a filter — the same
 * class of silent truncation #1208 fixes for search. Options must therefore come
 * from the caller's WHOLE accessible set, which is why this selects ids only (no
 * skip/take) and reuses `resolveCourseAccess` — the list and the facets cannot be
 * allowed to disagree about visibility.
 *
 * Gotchas:
 *   - Fail-soft, never a hard error: when Core is unavailable the catalog is
 *     empty, so terms/statuses come back empty with `X-Core-Status: unavailable`.
 *     That state is ALSO returned in the body as `coreUnavailable`, because the
 *     header is consumed by the client's `http()` wrapper and never reaches the
 *     route — which left a fail-closed search rendering "No courses match".
 *   - `progress` is offered only to callers whose rows carry progress, and only
 *     for buckets actually reachable. The fixed list was cheaper, but it offered
 *     filters that always yield nothing: `progressBucket` returns null for a
 *     course with no published activities, and `?progress=` excludes those from
 *     every bucket, so a student whose courses are all unpublished-inside got
 *     three options that each emptied their list.
 */
router.get("/courses/facets", async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: "Authentication required" });
  if (!isSupportedCourseRole(authUser.role)) {
    return res.status(403).json({ error: "Role is not supported in AI Tutor" });
  }

  try {
    const collectionContext = await resolveCourseCollectionContext(req, res);
    if (!collectionContext) return;
    const { catalogCourses, callerCourses, coreUnavailable } = collectionContext;
    await ensureAuthorizedCollectionAnchors(authUser, catalogCourses, callerCourses);
    const publishedCoreIds = catalogCourses.filter((c) => c?.isPublished === true).map((c) => c.id);

    const access = await resolveCourseAccess(authUser, {
      catalogCourses,
      publishedCoreIds,
      callerCourses,
    });

    // ADMIN sees the whole catalog, so skip the id query entirely. Everyone else
    // is scoped to the Core courses behind the offerings they can actually see.
    let scopedCatalog = catalogCourses;
    let scopedOfferingIds = null;
    if (access.kind !== "admin") {
      if (access.isEmpty) {
        scopedCatalog = [];
        scopedOfferingIds = [];
      } else {
        const visible = await prisma.courseOffering.findMany({
          where: access.where,
          select: { id: true, coreOfferingId: true },
        });
        const visibleCoreIds = new Set(visible.map((o) => o.coreOfferingId).filter(Boolean));
        scopedCatalog = catalogCourses.filter((c) => visibleCoreIds.has(c?.id));
        scopedOfferingIds = visible.map((o) => o.id);
      }
    }

    // Only offer buckets the list can actually return. This mirrors exactly what
    // `GET /courses` does when `?progress=` is supplied (same batch, same
    // `progressBucket`), so the dropdown and the filter can't disagree. In the TA
    // union, TA-held courses carry no progress and belong to no bucket, matching
    // the list's own exclusion.
    let progress = [];
    if (access.hasProgress) {
      if (scopedOfferingIds === null) {
        // ADMIN: no per-offering scoping ran, and admins hold no progress rows of
        // their own, so there is nothing to enumerate.
        progress = [];
      } else {
        const ids = scopedOfferingIds.filter((id) => {
          if (access.kind !== "taUnion") return true;
          const course = visible.find((candidate) => candidate.id === id);
          return !access.taCoreIdSet.has(course?.coreOfferingId);
        });
        const bucketed = await calculateCourseProgressBatch(ids, authUser.id);
        const present = new Set(ids.map((id) => progressBucket(bucketed.get(id))));
        progress = COURSE_PROGRESS_VALUES.filter((v) => present.has(v));
      }
    }

    // Values only, no labels: the client already owns the UBC term vocabulary
    // (`termLabel`) and uses it for the list's section headings. Labelling here
    // too would duplicate that logic and let the dropdown drift from the headings.
    const { terms, statuses } = coreFacets(scopedCatalog);
    res.json({
      terms,
      statuses,
      progress,
      coreUnavailable,
    });
  } catch (e) {
    sendSafeError(res, e, "Internal server error");
  }
});

/**
 * POST /courses/import-external — create a CourseOffering mirroring an EduAI course.
 *
 * Auth: INSTRUCTOR.
 * Side effects: creates CourseOffering + CourseInstructor inside a transaction,
 *   then fans out parallel topic + enrollment sync to EduAI; returns 409 if the
 *   instructor has already imported this externalCourseId.
 *
 * Why: post-create syncs run via `Promise.allSettled` so a flaky upstream call
 * for one of {topics, enrollments} doesn't block the other or roll back the
 * import. The instructor can rerun sync explicitly afterwards.
 */
router.post(
  "/courses/import-external",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const instructor = req.user;
    const parsedBody = ExternalCourseImportSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return res.status(400).json({ error: "externalCourseId is required" });
    }
    const { externalCourseId } = parsedBody.data;

    try {
      // #578: only courses in the instructor's Core-scoped list are importable.
      // A miss means the caller is not authorized for this Core course (not a 404).
      const externalCourse = await findEduAiCourseById(externalCourseId, {
        cookie: req.headers.cookie,
      });
      if (!externalCourse) {
        return res.status(403).json({ error: "CORE_COURSE_NOT_AUTHORIZED" });
      }
      if (
        instructor.role === "INSTRUCTOR" &&
        externalCourse.callerEnrollmentRole !== "INSTRUCTOR"
      ) {
        return res.status(403).json({ error: "CORE_COURSE_INSTRUCTOR_REQUIRED" });
      }

      // coreOfferingId is @unique — one AI Tutor offering per Core course
      // regardless of instructor. Import is an idempotent ENSURE (unified
      // contract): the throttled background mirror may have anchored this
      // course between the caller's list and this request, so "already
      // imported" is a success (200 with the existing row, instructor linkage
      // ensured by the service), not a conflict.
      const { offering, created } = await importExternalCourseForUser(instructor, externalCourse);

      // `externalCourse` is already the resolved Core course for this offering
      // (just fetched above) — pass it straight through rather than issuing a
      // second Core call.
      res.status(created ? 201 : 200).json(mapCourseOffering(offering, externalCourse));
    } catch (error) {
      logSafeError("[eduai] Failed to import course", error);
      return respondEduAiUpstreamError(res, error, "Unable to import course");
    }
  },
);

/**
 * POST /courses/:courseId/sync-enrollments — refresh student enrollments from Core (#578).
 *
 * Deprecated (#1065): `GET /courses/:courseId` now auto-syncs enrollments on
 * every read (needed for its own membership check), and the instructor
 * enrollments UI that called this manual endpoint has zero remaining
 * callers. Kept unreachable-from-UI for API compatibility, same treatment as
 * `POST /courses/:courseId/topics/sync` (#1031).
 *
 * Auth: course admin (LEAD instructor / unit-admin / admin).
 * Only EduAI-imported courses can sync; a native course has no Core roster to
 * pull from, so it returns 400 rather than a misleading empty sync.
 */
router.post(
  "/courses/:courseId/sync-enrollments",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const authUser = req.user;
    const courseId = Number(req.params.courseId);
    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ error: "Invalid course id" });
    }

    try {
      const course = await prisma.courseOffering.findUnique({
        where: { id: courseId },
        include: { instructors: { select: { userId: true } } },
      });
      if (!course) return res.status(404).json({ error: "Course not found" });
      if (!(await isCourseAdmin(authUser, course))) {
        return res.status(403).json({ error: "Not authorized for this course" });
      }
      if (!course.coreOfferingId) {
        return res.status(400).json({ error: "Course was not imported from EduAI" });
      }

      const result = await syncCourseEnrollments(courseId, { course });
      res.json(result);
    } catch (error) {
      logSafeError("[eduai] Failed to sync enrollments", error);
      return respondEduAiUpstreamError(res, error, "Unable to sync enrollments");
    }
  },
);

/**
 * `GET /courses/:courseId/bank-questions` — the shared question bank for the
 * activity picker.
 *
 * Auth: course admin (LEAD instructor / unit-admin / admin), same gate as the
 * other authoring routes.
 * Only EduAI-imported courses have a bank; a native course returns 400 rather
 * than a misleading empty list.
 * Returns `{ questions, hasMore, nextOffset }`. The service reads as many Core
 * pages as it needs to fill `limit` *usable* rows, so a run of long-answer or
 * select-all-that-apply questions no longer returns an empty picker (#1652
 * review). `hasMore` can only ever say "there may be more" — never an exact
 * remaining count, since the filter runs after Core already paged, and no
 * total is invented. `nextOffset` is the Core offset to resume from; it is not
 * `offset + limit`, because the filtered-out rows were consumed too.
 */
router.get(
  "/courses/:courseId/bank-questions",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const authUser = req.user;
    const courseId = Number(req.params.courseId);
    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ error: "Invalid course id" });
    }

    try {
      const course = await prisma.courseOffering.findUnique({
        where: { id: courseId },
        include: { instructors: { select: { userId: true } } },
      });
      if (!course) return res.status(404).json({ error: "Course not found" });
      if (!(await isCourseAdmin(authUser, course))) {
        return res.status(403).json({ error: "Not authorized for this course" });
      }
      if (!course.coreOfferingId) {
        return res.status(400).json({ error: "Course was not imported from EduAI" });
      }

      const limit = Number(req.query.limit) || 20;
      const offset = Number(req.query.offset) || 0;
      const { questions, hasMore, nextOffset } = await listBankQuestions(course.coreOfferingId, {
        topicId: req.query.topicId || undefined,
        limit,
        offset,
      });
      res.json({ questions, hasMore, nextOffset });
    } catch (error) {
      logSafeError("[eduai] Failed to list bank questions", error);
      return respondEduAiUpstreamError(res, error, "Unable to load the question bank");
    }
  },
);

/**
 * GET /courses/:courseId — single course details + membership check.
 *
 * Auth: enrolled student, TA, course instructor, unit admin, or admin.
 *
 * Why: this route's own membership check reads the local `CourseEnrollment`
 * mirror, so a stale mirror isn't just a display bug here — it's an
 * authorization bug (a removed student could still pass the `isMember`
 * check). Student/TA callers use the uncached live authorization helper,
 * which serializes Core fetch + reconciliation + effective-role read and
 * fails closed with a stable 503 when Core is unavailable. Staff roles have
 * authorization independent of the enrollment mirror, so they retain the
 * bounded local-sync fallback used by management surfaces.
 */
router.get("/courses/:courseId", async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: "Authentication required" });
  if (!isSupportedCourseRole(authUser.role)) {
    return res.status(403).json({ error: "Role is not supported in AI Tutor" });
  }

  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: "Invalid course id" });
  }

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: {
        instructors: { select: { userId: true } },
      },
    });

    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    const isLearner = authUser.role === "STUDENT" || authUser.role === "TA";
    let liveEnrollment = null;
    let liveStaffPrincipal = null;

    if (isLearner) {
      try {
        liveEnrollment = await authorizeLiveStudentEnrollment(courseId, authUser.id, {
          course,
          allowedRoles: ["STUDENT", "TA"],
        });
      } catch {
        liveEnrollment = { allowed: false, state: "unavailable", role: null };
      }

      if (liveEnrollment?.state === "unavailable") {
        return res.status(503).json({
          error: LIVE_ENROLLMENT_AUTH_UNAVAILABLE_MESSAGE,
          code: LIVE_ENROLLMENT_AUTH_UNAVAILABLE_CODE,
        });
      }
    } else {
      try {
        liveStaffPrincipal = await authorizeLiveCoursePrincipal(course, authUser);
      } catch {
        liveStaffPrincipal = { state: "unavailable", kind: null, role: null };
      }
      if (liveStaffPrincipal.state === "unavailable") {
        return res.status(503).json({
          error: LIVE_COURSE_AUTH_UNAVAILABLE_MESSAGE,
          code: LIVE_COURSE_AUTH_UNAVAILABLE_CODE,
        });
      }
      if (!isAllowedLiveCourseStaffPrincipal(liveStaffPrincipal)) {
        return res.status(403).json({ error: "Not authorized for this course" });
      }

      if (course.coreOfferingId) {
        // Retain the response-data synchronization only after exact live
        // staff authorization has succeeded; a stale mirror never grants
        // access and a Core outage cannot trigger a local write.
        try {
          await syncCourseEnrollments(courseId, {
            course,
            ttlMs: AUTO_SYNC_TTL_MS,
            signal: AbortSignal.timeout(AUTO_SYNC_TIMEOUT_MS),
          });
        } catch (e) {
          const phase = e?.phase === "write" ? "local write" : "Core fetch";
          logSafeError(
            `[courses] Staff enrollment auto-sync (${phase}) failed after live authorization`,
            e,
          );
        }
      }
    }

    // #1072 step 2/4: single-course read-through for the response body —
    // `department` is Core-owned data, not a local column. Degrades to a
    // stale-but-present course on any Core failure rather than hard-erroring.
    // Bounded to
    // `AUTO_SYNC_TIMEOUT_MS` (#1173 review) — without a signal here, a Core
    // that's up but hung on this lookup defeats the local fallback the
    // enrollment sync above was just bounded to guarantee.
    const { course: coreCourse, coreUnavailable } = await resolveCoreCourseById(
      course.coreOfferingId,
      {
        signal: AbortSignal.timeout(AUTO_SYNC_TIMEOUT_MS),
      },
    );
    if (coreUnavailable) {
      res.set("X-Core-Status", "unavailable");
    }

    const isMember = isLearner
      ? liveEnrollment?.allowed === true
      : isAllowedLiveCourseStaffPrincipal(liveStaffPrincipal);

    if (!isMember) {
      return res.status(403).json({ error: "Not authorized for this course" });
    }

    // The caller's role *on this course* (not their global effective role). The
    // client gates course-detail staff tabs on this so a global-effective TA who
    // is only a STUDENT on this course sees no staff tabs (#1644). Learners get
    // the live enrolment role; staff get their principal role, falling back to
    // the principal kind (a unit admin authorized by unit has no enrolment role).
    const viewerRole = isLearner
      ? (liveEnrollment?.role ?? null)
      : (liveStaffPrincipal?.role ?? liveStaffPrincipal?.kind ?? null);

    res.json({ ...mapCourseOffering(course, coreCourse), viewerRole });
  } catch (e) {
    sendSafeError(res, e, "Internal server error");
  }
});

/**
 * POST /courses — deprecated (#632). Course creation is owned by EduAI Core.
 * Always returns 403 so legacy clients cannot create offerings locally.
 */
router.post("/courses", requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]), async (_req, res) => {
  return res.status(403).json({
    error: "Course creation is managed in EduAI Core. Import or enable courses from Core instead.",
  });
});

/**
 * POST /courses/:courseId/import — selectively clone modules or lessons into
 * an existing course.
 *
 * Auth: INSTRUCTOR on both source and destination courses.
 * Body: either `{ sourceCourseId, moduleIds }` to clone whole modules, or
 *   `{ lessonIds, targetModuleId }` to clone individual lessons into a chosen
 *   destination module.
 * Side effects: deep-copies via `cloneCourseContent` / `cloneLessonsFromOffering`.
 *
 * Why: lesson-level imports require an explicit `targetModuleId` because
 * lessons have no implicit destination, whereas module-level imports preserve
 * their structure.
 */
router.post(
  "/courses/:courseId/import",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const authUser = req.user;
    const courseId = Number(req.params.courseId);
    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ error: "Invalid course id" });
    }
    const parsedBody = CourseContentImportSchema.safeParse(req.body);
    if (!parsedBody.success) {
      const field = parsedBody.error.issues[0]?.path[0];
      return res.status(400).json({
        error: field === "sourceCourseId" ? "Invalid sourceCourseId" : "Invalid import request",
      });
    }

    try {
      const updated = await importCourseContentForUser({
        courseId,
        body: parsedBody.data,
        user: authUser,
      });
      res.json(updated);
    } catch (e) {
      if (e instanceof CourseMutationError) {
        // JSON.stringify drops an undefined value, so an error without a
        // machine-readable code still serializes to a bare `{ error }`.
        return res.status(e.status).json({ error: e.message, code: e.code || undefined });
      }
      sendSafeError(res, e, "Internal server error");
    }
  },
);

/**
 * PATCH /courses/:courseId/publish — flip course to published.
 *
 * Auth: ADMIN (global), UNIT_ADMIN (D-scoped), INSTRUCTOR (C-scoped).
 *
 * Why: intentionally non-cascading. Publishing a course doesn't auto-publish
 * its modules/lessons; the instructor must opt them in individually so a
 * half-finished module can't leak to students.
 */
router.patch(
  "/courses/:courseId/publish",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const authUser = req.user;
    const courseId = Number(req.params.courseId);
    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ error: "Invalid course id" });
    }

    try {
      const { course, resolved } = await publishCourseForUser({
        courseId,
        user: authUser,
        cookie: req.headers.cookie,
      });
      if (resolved.coreUnavailable) {
        res.set("X-Core-Status", "unavailable");
      }
      res.json(mapCourseOfferingAfterPublishWrite(course, resolved, true));
    } catch (e) {
      if (e instanceof CourseMutationError) {
        // JSON.stringify drops an undefined value, so an error without a
        // machine-readable code still serializes to a bare `{ error }`.
        return res.status(e.status).json({ error: e.message, code: e.code || undefined });
      }
      sendSafeError(res, e, "Internal server error");
    }
  },
);

/**
 * PATCH /courses/:courseId/unpublish — flip course unpublished, cascading down.
 *
 * Auth: ADMIN (global), UNIT_ADMIN (D-scoped), INSTRUCTOR (C-scoped).
 * Side effects: writes `isPublished=false` through to Core (the sole store
 *   for course publish state, #1072 step 4), then in a single local
 *   transaction sets `isPublished=false` on all of the course's modules and
 *   lessons.
 *
 * Why: the asymmetry with publish is deliberate — unpublishing must
 * immediately hide ALL child content from students; without the cascade a
 * module/lesson could remain reachable by direct URL.
 */
router.patch(
  "/courses/:courseId/unpublish",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const authUser = req.user;
    const courseId = Number(req.params.courseId);
    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ error: "Invalid course id" });
    }

    try {
      const { course, resolved } = await unpublishCourseForUser({
        courseId,
        user: authUser,
        cookie: req.headers.cookie,
      });
      if (resolved.coreUnavailable) {
        res.set("X-Core-Status", "unavailable");
      }
      res.json(mapCourseOfferingAfterPublishWrite(course, resolved, false));
    } catch (e) {
      if (e instanceof CourseMutationError) {
        // JSON.stringify drops an undefined value, so an error without a
        // machine-readable code still serializes to a bare `{ error }`.
        return res.status(e.status).json({ error: e.message, code: e.code || undefined });
      }
      sendSafeError(res, e, "Internal server error");
    }
  },
);

// ── Course-level analytics (§310) ─────────────────────────────────

/**
 * GET /courses/:courseId/feedback — all ActivityFeedback in the course.
 *
 * Auth: ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C). STUDENT → 403.
 * Query params: activityId, studentId, take (default 50, max 200), skip (default 0).
 */
router.get("/courses/:courseId/feedback", async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: "Authentication required" });
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) return res.status(400).json({ error: "Invalid course id" });

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: {
        instructors: { select: { userId: true } },
        enrollments: { select: { userId: true, role: true } },
      },
    });
    if (!course) return res.status(404).json({ error: "Course not found" });

    const membership = await resolveCourseStaffMembership(course, authUser);
    if (membership.principal.state === "unavailable") {
      return res.status(503).json({
        error: "Course authorization unavailable",
        code: "COURSE_AUTH_UNAVAILABLE",
      });
    }
    const { hasAdminAccess, isTa } = membership;
    if (!hasAdminAccess && !isTa) {
      return res.status(403).json({ error: "Not authorized for this course" });
    }

    const { activityId, studentId } = req.query;
    if (req.query.take !== undefined && !Number.isFinite(Number(req.query.take))) {
      return res.status(400).json({ error: "take must be a number" });
    }
    if (req.query.skip !== undefined && !Number.isFinite(Number(req.query.skip))) {
      return res.status(400).json({ error: "skip must be a number" });
    }
    const take = Math.min(Math.max(Number(req.query.take) || 50, 1), 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    const where = {
      activity: { lesson: { module: { courseOfferingId: courseId } } },
    };
    if (activityId !== undefined) {
      if (!Number.isFinite(Number(activityId))) {
        return res.status(400).json({ error: "activityId must be a number" });
      }
      where.activityId = Number(activityId);
    }
    if (studentId) where.userId = studentId;

    const feedback = await prisma.activityFeedback.findMany({
      where,
      orderBy: [{ activityId: "asc" }, { userId: "asc" }, { createdAt: "asc" }],
      take,
      skip,
    });

    res.json(feedback);
  } catch (e) {
    sendSafeError(res, e, "Internal server error");
  }
});

/**
 * GET /courses/:courseId/submissions — all submissions in the course.
 *
 * Auth: ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C).
 * Query params: activityId, studentId, take (default 50, max 200), skip (default 0).
 */
router.get("/courses/:courseId/submissions", async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: "Authentication required" });
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) return res.status(400).json({ error: "Invalid course id" });

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: {
        instructors: { select: { userId: true } },
        enrollments: { select: { userId: true, role: true } },
      },
    });
    if (!course) return res.status(404).json({ error: "Course not found" });

    const membership = await resolveCourseStaffMembership(course, authUser);
    if (membership.principal.state === "unavailable") {
      return res.status(503).json({
        error: "Course authorization unavailable",
        code: "COURSE_AUTH_UNAVAILABLE",
      });
    }
    const { hasAdminAccess, isTa } = membership;
    if (!hasAdminAccess && !isTa) {
      return res.status(403).json({ error: "Not authorized for this course" });
    }

    const { activityId, studentId } = req.query;
    if (req.query.take !== undefined && !Number.isFinite(Number(req.query.take))) {
      return res.status(400).json({ error: "take must be a number" });
    }
    if (req.query.skip !== undefined && !Number.isFinite(Number(req.query.skip))) {
      return res.status(400).json({ error: "skip must be a number" });
    }
    const take = Math.min(Math.max(Number(req.query.take) || 50, 1), 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    const where = {
      activity: { lesson: { module: { courseOfferingId: courseId } } },
    };
    if (activityId !== undefined) {
      if (!Number.isFinite(Number(activityId))) {
        return res.status(400).json({ error: "activityId must be a number" });
      }
      where.activityId = Number(activityId);
    }
    if (studentId) where.userId = studentId;

    const submissions = await prisma.submission.findMany({
      where,
      // `id` last: Submission has no unique constraint covering the leading
      // keys, so without it tied rows could shift between offset pages.
      orderBy: [{ activityId: "asc" }, { userId: "asc" }, { attemptNumber: "asc" }, { id: "asc" }],
      take,
      skip,
      include: {
        activity: {
          select: {
            id: true,
            title: true,
            config: true,
            lesson: { select: { title: true } },
          },
        },
      },
    });

    // Resolve Core-owned student names (identity lives in Core, not this DB).
    // Best-effort: a missing service key or Core hiccup falls back to the raw
    // userId so the panel still renders.
    const nameById = new Map();
    if (course.coreOfferingId) {
      try {
        const enrollments = await listEduAiCourseEnrollmentsServiceKey(course.coreOfferingId);
        for (const enrollment of enrollments) {
          if (enrollment?.studentId) nameById.set(enrollment.studentId, enrollment.studentName);
        }
      } catch {
        // Leave the map empty; rows degrade to the userId.
      }
    }

    const enriched = submissions.map((submission) => {
      const { activity, ...rest } = submission;
      const config = activity?.config ?? {};
      const choices = extractChoices(config);
      const response = rest.response ?? null;
      // MCQ picks store a zero-based option index; map it back to the option
      // label so instructors read the answer, not "Option 3".
      const optionIndex =
        response && typeof response.answerOption === "number" ? response.answerOption : null;
      const answerLabel =
        optionIndex != null && choices && choices[optionIndex] != null
          ? choices[optionIndex]
          : null;
      return {
        ...rest,
        studentName: nameById.get(rest.userId) ?? null,
        activityTitle: activity?.title ?? null,
        lessonTitle: activity?.lesson?.title ?? null,
        questionText: config.question ?? config.prompt ?? null,
        answerLabel,
      };
    });

    res.json(enriched);
  } catch (e) {
    sendSafeError(res, e, "Internal server error");
  }
});

/**
 * GET /courses/:courseId/student-metrics — per-student aggregated metrics.
 *
 * Auth: ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C).
 */
router.get("/courses/:courseId/student-metrics", async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: "Authentication required" });
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) return res.status(400).json({ error: "Invalid course id" });

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: {
        instructors: { select: { userId: true } },
        enrollments: { select: { userId: true, role: true } },
      },
    });
    if (!course) return res.status(404).json({ error: "Course not found" });

    const membership = await resolveCourseStaffMembership(course, authUser);
    if (membership.principal.state === "unavailable") {
      return res.status(503).json({
        error: "Course authorization unavailable",
        code: "COURSE_AUTH_UNAVAILABLE",
      });
    }
    const { hasAdminAccess, isTa } = membership;
    if (!hasAdminAccess && !isTa) {
      return res.status(403).json({ error: "Not authorized for this course" });
    }

    const rawMetrics = await prisma.activityStudentMetric.findMany({
      where: { activity: { lesson: { module: { courseOfferingId: courseId } } } },
    });

    // Same best-effort Core name resolution as the submissions route above —
    // without it the panel prints raw user ids where Submissions shows names.
    const nameById = new Map();
    if (course.coreOfferingId) {
      try {
        const enrollments = await listEduAiCourseEnrollmentsServiceKey(course.coreOfferingId);
        for (const enrollment of enrollments) {
          if (enrollment?.studentId) nameById.set(enrollment.studentId, enrollment.studentName);
        }
      } catch {
        // Leave the map empty; rows degrade to the userId.
      }
    }

    const byStudent = {};
    for (const m of rawMetrics) {
      if (!byStudent[m.userId]) {
        byStudent[m.userId] = {
          userId: m.userId,
          studentName: nameById.get(m.userId) ?? null,
          submissionCount: 0,
          correctSubmissionCount: 0,
          incorrectSubmissionCount: 0,
          helpRequestCount: 0,
        };
      }
      byStudent[m.userId].submissionCount += m.submissionCount;
      byStudent[m.userId].correctSubmissionCount += m.correctSubmissionCount;
      byStudent[m.userId].incorrectSubmissionCount += m.incorrectSubmissionCount;
      byStudent[m.userId].helpRequestCount += m.helpRequestCount;
    }

    res.json(Object.values(byStudent));
  } catch (e) {
    sendSafeError(res, e, "Internal server error");
  }
});

/**
 * GET /courses/:courseId/analytics — per-activity aggregate analytics.
 *
 * Auth: ADMIN / UNIT_ADMIN(D) / INSTRUCTOR(C) / TA(C).
 */
router.get("/courses/:courseId/analytics", async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: "Authentication required" });
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) return res.status(400).json({ error: "Invalid course id" });

  try {
    const course = await prisma.courseOffering.findUnique({
      where: { id: courseId },
      include: {
        instructors: { select: { userId: true } },
        enrollments: { select: { userId: true, role: true } },
      },
    });
    if (!course) return res.status(404).json({ error: "Course not found" });

    const membership = await resolveCourseStaffMembership(course, authUser);
    if (membership.principal.state === "unavailable") {
      return res.status(503).json({
        error: "Course authorization unavailable",
        code: "COURSE_AUTH_UNAVAILABLE",
      });
    }
    const { hasAdminAccess, isTa } = membership;
    if (!hasAdminAccess && !isTa) {
      return res.status(403).json({ error: "Not authorized for this course" });
    }

    const analytics = await prisma.activityAnalytics.findMany({
      where: { activity: { lesson: { module: { courseOfferingId: courseId } } } },
      include: { activity: { select: { id: true, title: true, lessonId: true } } },
      orderBy: { activityId: "asc" },
    });

    res.json(analytics);
  } catch (e) {
    sendSafeError(res, e, "Internal server error");
  }
});

// ── Dashboard rollups (§938) ─────────────────────────────────────

/**
 * GET /me/dashboard-stats — role-aware aggregate rollup across the caller's
 * visible courses.
 *
 * Auth: any authenticated user; response shape is scoped by role.
 * Returns numbers backed only by local tables (CourseOffering,
 * CourseEnrollment, Submission) plus, for ADMIN, counts sourced from the
 * existing Core admin-user / bug-report service calls already used elsewhere
 * in this file — never fabricated fields.
 *
 * Why: STUDENT/TA/INSTRUCTOR/UNIT_ADMIN/ADMIN all want a different rollup, so
 * this branches on role the same way `GET /courses` does rather than trying
 * to force one shape onto every caller.
 */
router.get("/me/dashboard-stats", async (req, res) => {
  const authUser = req.user;
  if (!authUser) return res.status(401).json({ error: "Authentication required" });

  try {
    // Unified contract (#1072): published counts are FIELD reads — one
    // batched service-key catalog fetch, never the cookie-scoped list (whose
    // contents depend on the caller's own Core enrollment). No cookie-scoped
    // Core call happens in this route at all; nothing here consumes
    // `callerEnrollmentRole`.
    const collectionContext = await resolveCourseCollectionContext(req, res);
    if (!collectionContext) return;
    const { catalogCourses, callerCourses, coreUnavailable } = collectionContext;
    const coreCoursesById = indexCoreCoursesById(catalogCourses);
    if (coreUnavailable) {
      res.set("X-Core-Status", "unavailable");
    }
    const isCorePublished = (offering) => resolveIsPublished(offering, coreCoursesById);

    if (authUser.role === "ADMIN") {
      const courses = await prisma.courseOffering.findMany({
        select: { coreOfferingId: true },
      });
      const publishedCourses = courses.filter(isCorePublished).length;

      const stats = {
        role: "ADMIN",
        totalCourses: courses.length,
        publishedCourses,
        // #1043: the dashboard donut derived these from the full course array;
        // now that GET /courses is paged, they come from here (whole-set counts).
        draftCourses: courses.length - publishedCourses,
        syncedCourses: courses.filter((c) => c.coreOfferingId != null).length,
      };

      try {
        // #1041: read Core's `total` instead of counting a fetched list —
        // one row over the wire instead of the whole user table.
        const users = await listCoreAdminUsers(req.headers.cookie ?? "", { pageSize: 1 });
        if (typeof users?.total === "number") stats.totalUsers = users.total;
      } catch (err) {
        logSafeError("[me/dashboard-stats] Could not fetch Core users", err);
      }

      try {
        const reports = await listAdminBugReports(getEduAiCookieForRequest(req));
        if (Array.isArray(reports)) {
          stats.openBugReports = reports.filter((r) => r.status === "unhandled").length;
        }
      } catch (err) {
        logSafeError("[me/dashboard-stats] Could not fetch bug reports", err);
      }

      return res.json(stats);
    }

    await ensureAuthorizedCollectionAnchors(authUser, catalogCourses, callerCourses);
    const publishedCoreIds = catalogCourses.filter((c) => c?.isPublished === true).map((c) => c.id);
    const access = await resolveCourseAccess(authUser, {
      catalogCourses,
      publishedCoreIds,
      callerCourses,
    });

    if (authUser.role === "INSTRUCTOR" || authUser.role === "UNIT_ADMIN") {
      // `department` is Core-owned (#1072 step 4) — join the batch fetched
      // above rather than filtering by a local column. Same fail-soft
      // posture as `GET /courses`'s UNIT_ADMIN branch: an empty/unavailable
      // Core list degrades the department scope to empty, not an error.
      const courses = await prisma.courseOffering.findMany({
        where: access.where,
        select: { id: true, coreOfferingId: true },
      });
      const courseIds = courses.map((c) => c.id);
      const publishedCourses = courses.filter(isCorePublished).length;

      let enrolledStudents = 0;
      let submissionsToReview = 0;
      if (courseIds.length > 0) {
        const distinctStudents = await prisma.courseEnrollment.findMany({
          where: { courseOfferingId: { in: courseIds }, role: "STUDENT" },
          select: { userId: true },
          distinct: ["userId"],
        });
        enrolledStudents = distinctStudents.length;

        submissionsToReview = await prisma.submission.count({
          where: {
            isCorrect: null,
            activity: { lesson: { module: { courseOfferingId: { in: courseIds } } } },
          },
        });
      }

      return res.json({
        role: authUser.role,
        // Same value under two keys so the instructor view (yourCourses) and the
        // unit-admin view (totalCourses) each read the field they expect.
        yourCourses: courses.length,
        totalCourses: courses.length,
        publishedCourses,
        draftCourses: courses.length - publishedCourses,
        // #1043: the "synced" tile derived this from the full course array.
        syncedCourses: courses.filter((c) => c.coreOfferingId != null).length,
        enrolledStudents,
        submissionsToReview,
      });
    }

    // TA — either the platform role is TA, or a STUDENT account also holds a
    // TA enrollment on at least one course (mirrors GET /courses §174).
    const isEffectiveTa = authUser.role === "TA" || access.kind === "taUnion";

    if (isEffectiveTa) {
      const taCourses = await prisma.courseOffering.findMany({
        where: { coreOfferingId: { in: [...access.taCoreIdSet] } },
        select: { id: true, coreOfferingId: true },
      });
      const courseIds = taCourses.map((course) => course.id);

      const submissionsToReview =
        courseIds.length > 0
          ? await prisma.submission.count({
              where: {
                isCorrect: null,
                activity: { lesson: { module: { courseOfferingId: { in: courseIds } } } },
              },
            })
          : 0;
      const publishedCourses = taCourses.filter(isCorePublished).length;

      return res.json({
        role: "TA",
        yourCourses: courseIds.length,
        publishedCourses,
        submissionsToReview,
      });
    }

    // STUDENT (default)
    const rawCourses = await prisma.courseOffering.findMany({
      where: access.where,
      select: { id: true, coreOfferingId: true },
    });
    const courses = rawCourses.filter(isCorePublished);

    // #1208: one batched call across every enrolled course — this was a
    // per-course `calculateCourseProgress` fan-out (2 queries each).
    const progressById = await calculateCourseProgressBatch(
      courses.map((c) => c.id),
      authUser.id,
    );
    const progresses = [...progressById.values()];
    const completedCourses = progresses.filter(
      (p) => p.total > 0 && p.completed === p.total,
    ).length;
    const inProgressCourses = progresses.filter(
      (p) => p.total > 0 && p.completed > 0 && p.completed < p.total,
    ).length;

    const [correctCount, gradedCount] = await Promise.all([
      prisma.submission.count({ where: { userId: authUser.id, isCorrect: true } }),
      prisma.submission.count({ where: { userId: authUser.id, isCorrect: { not: null } } }),
    ]);
    const correctAnswerPercentage =
      gradedCount > 0 ? Math.round((correctCount / gradedCount) * 100) : 0;

    res.json({
      role: "STUDENT",
      enrolledCourses: courses.length,
      coursesInProgress: inProgressCourses,
      coursesCompleted: completedCourses,
      correctAnswerPercentage,
    });
  } catch (e) {
    sendSafeError(res, e, "Internal server error");
  }
});

export default router;
