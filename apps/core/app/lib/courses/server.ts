import { UserRole, type Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import {
  paginatedResponse,
  parseIdsParam,
  parsePaginationParams,
  parseSearchParam,
  unpagedResponse,
  type Pagination,
} from "~/lib/pagination.server";
import { auth } from "~/lib/auth/server";
import {
  enforceAdminIfApiKey,
  requireServiceKey,
} from "~/lib/auth/guards.server";
import {
  apiError,
  jsonResponse,
  validationErrorFromZod,
} from "~/lib/api-error.server";
import {
  buildCourseListFilter,
  getAuthorizedUnits,
  resolveCourseAccessWithCourse,
  wantsIncludeDeleted,
} from "~/lib/auth/course-access.server";
import { getPolicy, denyByPolicy } from "~/lib/policy.server";
import { assertValidDepartment } from "~/lib/disciplines/guards.server";
import { canCreateCourse } from "~/lib/rbac/permissions";
import type { RbacUser } from "~/lib/rbac/types";
import { cascadeDeleteToExtensions } from "./cascadeDelete.server";
import {
  CreateCourseSchema,
  UpdateCourseSchema,
  CreateCourseTopicSchema,
  UpdateCourseTopicSchema,
  DeleteCourseTopicSchema,
  type CreateCourseTopicInput,
  type UpdateCourseTopicInput,
  type DeleteCourseTopicInput,
} from "./schemas";

async function parseCreateCourseBody(
  request: Request,
  opts?: { forceInstructorUserIds?: string[] },
) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return {
        ok: false as const,
        response: apiError(422, "VALIDATION_ERROR", { body: "invalid JSON" }),
      };
    }
    if (
      opts?.forceInstructorUserIds?.length &&
      body &&
      typeof body === "object"
    ) {
      body = { ...body, instructorUserIds: opts.forceInstructorUserIds };
    }
    const parsed = CreateCourseSchema.safeParse(body);
    if (!parsed.success) {
      return {
        ok: false as const,
        response: validationErrorFromZod(parsed.error),
      };
    }
    return { ok: true as const, data: parsed.data };
  }

  const formData = await request.formData();
  const instructorUserIds = formData
    .getAll("instructorUserIds")
    .map((value) => String(value))
    .filter(Boolean);

  if (instructorUserIds.length === 0) {
    const rawInstructorUserIds = formData.get("instructorUserIds");
    if (typeof rawInstructorUserIds === "string" && rawInstructorUserIds) {
      try {
        const parsed = JSON.parse(rawInstructorUserIds);
        if (Array.isArray(parsed)) {
          instructorUserIds.push(...parsed.map(String).filter(Boolean));
        } else {
          instructorUserIds.push(rawInstructorUserIds);
        }
      } catch {
        instructorUserIds.push(rawInstructorUserIds);
      }
    }
  }

  if (opts?.forceInstructorUserIds?.length) {
    instructorUserIds.length = 0;
    instructorUserIds.push(...opts.forceInstructorUserIds);
  }

  const data = {
    name: formData.get("name"),
    code: formData.get("code"),
    section: formData.get("section"),
    term: formData.get("term"),
    year: Number(formData.get("year")),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate") || undefined,
    department: formData.get("department") || undefined,
    description: formData.get("description") || undefined,
    isPublished: formData.get("isPublished") ?? undefined,
    aiInstructions: formData.get("aiInstructions") || "",
    instructorUserIds,
  };

  const parsed = CreateCourseSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false as const,
      response: validationErrorFromZod(parsed.error),
    };
  }
  return { ok: true as const, data: parsed.data };
}

// ---------------------------------------------------------------------------
// Per-course RAG settings cache
//
// Avoids a DB round-trip on every findRelevantContent call (one per RAG query).
// TTL defaults to 60 min; tune with COURSE_RAG_SETTINGS_CACHE_TTL_MS.
// Invalidated explicitly on PATCH /api/courses/:id/rag-settings.
// ---------------------------------------------------------------------------

type RagSettingsCacheEntry = {
  value: {
    ragTopK: number | null;
    ragSimilarityThreshold: number | null;
  } | null;
  expiresAt: number;
};

const ragSettingsCache = new Map<string, RagSettingsCacheEntry>();

const COURSE_RAG_SETTINGS_CACHE_TTL_MS = Math.min(
  7_200_000, // 2 h ceiling
  Math.max(
    5_000,
    Number(process.env.COURSE_RAG_SETTINGS_CACHE_TTL_MS) || 3_600_000,
  ),
);

/** Remove all entries whose TTL has elapsed. */
function pruneRagSettingsCache(): void {
  const now = Date.now();
  for (const [key, entry] of ragSettingsCache) {
    if (entry.expiresAt <= now) ragSettingsCache.delete(key);
  }
}

/** Drop a single course's entry so the next read fetches fresh data from DB. */
export function invalidateCourseRagSettingsCache(courseId: string): void {
  ragSettingsCache.delete(courseId);
}

// ---------------------------------------------------------------------------
// Per-course topic-name cache
//
// Course-scope classification (course-scope-guardrail.ts) loads topic names
// on every browser course-chat turn. Same TTL/invalidation shape as the RAG
// settings cache above to avoid a DB round-trip on that critical path.
// ---------------------------------------------------------------------------

type CourseTopicNamesCacheEntry = {
  value: string[];
  expiresAt: number;
};

const courseTopicNamesCache = new Map<string, CourseTopicNamesCacheEntry>();

function pruneCourseTopicNamesCache(): void {
  const now = Date.now();
  for (const [key, entry] of courseTopicNamesCache) {
    if (entry.expiresAt <= now) courseTopicNamesCache.delete(key);
  }
}

/** Drop a single course's cached topic names so the next read fetches fresh data. */
export function invalidateCourseTopicNamesCache(courseId: string): void {
  courseTopicNamesCache.delete(courseId);
}

/**
 * Cached topic-name lookup for a course. Backed by getCourseTopics so it stays
 * consistent with the deletedAt: null filter used everywhere else. Cached in
 * memory for COURSE_RAG_SETTINGS_CACHE_TTL_MS (reuses the RAG settings TTL —
 * both are low-churn, read-heavy per-course settings) to avoid a DB
 * round-trip on every course-chat turn.
 */
export async function getCourseTopicNamesCached(
  courseId: string,
): Promise<string[]> {
  pruneCourseTopicNamesCache();

  const now = Date.now();
  const cached = courseTopicNamesCache.get(courseId);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const topics = await getCourseTopics(courseId);
  const value = topics.map((topic) => topic.name);

  courseTopicNamesCache.set(courseId, {
    value,
    expiresAt: now + COURSE_RAG_SETTINGS_CACHE_TTL_MS,
  });
  return value;
}

/**
 * GET /api/courses — list active courses.
 *
 * Auth:
 *   - Service key (Authorization: Bearer EDUAI_API_KEY): unrestricted — used by AI Tutor
 *     to list importable courses without requiring an admin session.
 *   - User session: scoped to the caller (§5): ADMIN all;
 *     UNIT_ADMIN authorized units; INSTRUCTOR/TA enrolled; STUDENT enrolled + published.
 *
 * Paging (#1041): `page` and `pageSize` are required and the response is the
 * standard `{ data, total, page, pageSize }` envelope. `?ids=` and `?search=`
 * are the lookup surfaces (#1125); `ids` replaces paging rather than combining
 * with it. Access scoping is applied before the selectors, so `ids`/`search`
 * can never widen what a caller may see.
 */
export async function getCourses(request: Request) {
  const searchParams = new URL(request.url).searchParams;

  // Authenticate before parsing: an anonymous caller must see 401, not a 400
  // describing which query params this endpoint wants.
  type SessionUser = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>["user"];
  type Caller = { kind: "serviceKey" } | { kind: "session"; user: SessionUser };

  let caller: Caller;
  if (request.headers.get("Authorization")?.startsWith("Bearer ")) {
    const serviceKeyGuard = await requireServiceKey(request);
    if (serviceKeyGuard) return serviceKeyGuard;
    caller = { kind: "serviceKey" };
  } else {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" } as const,
      });
    }
    caller = { kind: "session", user: session.user };
  }

  // #1041: `page`/`pageSize` are required; `?ids=` is the unpaged batch-lookup
  // escape hatch for callers resolving a known set of courses (#1125).
  const idsResult = parseIdsParam(searchParams);
  if ("response" in idsResult) return idsResult.response;

  const search = parseSearchParam(searchParams);

  let pagination: Pagination | null = null;
  if (!idsResult.ids) {
    const paginationResult = parsePaginationParams(searchParams);
    if ("response" in paginationResult) return paginationResult.response;
    pagination = paginationResult.pagination;
  }

  const isActiveParam = searchParams.get("isActive");

  /** Narrow an access-scoped filter with the caller's `ids`/`search` selectors. */
  const withSelectors = (base: Prisma.CourseWhereInput): Prisma.CourseWhereInput => {
    const and: Prisma.CourseWhereInput[] = [base];
    if (idsResult.ids) and.push({ id: { in: idsResult.ids } });
    if (isActiveParam !== null) and.push({ isActive: isActiveParam === "true" });
    if (search) {
      and.push({
        OR: [
          { code: { contains: search, mode: "insensitive" } },
          { name: { contains: search, mode: "insensitive" } },
        ],
      });
    }
    return and.length === 1 ? base : { AND: and };
  };

  const listCourses = async (where: Prisma.CourseWhereInput) => {
    if (!pagination) {
      const rows = await prisma.course.findMany({ where, orderBy: { code: "asc" } });
      return { rows, total: rows.length };
    }
    const [total, rows] = await prisma.$transaction([
      prisma.course.count({ where }),
      prisma.course.findMany({
        where,
        orderBy: { code: "asc" },
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);
    return { rows, total };
  };

  // Service key path: AI Tutor and other extensions call this with Authorization: Bearer
  if (caller.kind === "serviceKey") {
    const { rows, total } = await listCourses(withSelectors({ deletedAt: null }));
    return pagination ? paginatedResponse(rows, total, pagination) : unpagedResponse(rows);
  }

  // §19 forensics opt-in (#315): ADMIN may pass ?includeDeleted=true to surface
  // soft-deleted courses. The flag is a no-op for every non-ADMIN caller.
  const includeDeleted = wantsIncludeDeleted(request, caller.user);

  const { rows: courses, total } = await listCourses(
    withSelectors(await buildCourseListFilter(caller.user, includeDeleted)),
  );

  const enrollmentRows = await prisma.enrollment.findMany({
    where: {
      userId: caller.user.id,
      isActive: true,
      courseId: { in: courses.map((course) => course.id) },
    },
    select: { courseId: true, role: true },
  });
  const roleByCourseId = new Map(
    enrollmentRows.map((row) => [row.courseId, row.role]),
  );
  const coursesWithCallerRole = courses.map((course) => ({
    ...course,
    callerEnrollmentRole: roleByCourseId.get(course.id) ?? null,
  }));

  return pagination
    ? paginatedResponse(coursesWithCallerRole, total, pagination)
    : unpagedResponse(coursesWithCallerRole);
}

/**
 * POST /api/courses — create a course.
 *
 * Authorized for ADMIN and UNIT_ADMIN (within their authorized units). An
 * INSTRUCTOR may also self-create when the `instructors.canCreateCourses` policy
 * flag is enabled; they are auto-enrolled as the course instructor.
 */
export async function createCourse(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  const role = session?.user?.role ?? "";
  const canCreate =
    (session?.user != null && canCreateCourse(session.user as RbacUser)) ||
    (role === "INSTRUCTOR" &&
      (await getPolicy("instructors.canCreateCourses")));
  if (!session?.user || !canCreate) {
    if (session?.user && role === "INSTRUCTOR") {
      return denyByPolicy({
        request,
        policyKey: "instructors.canCreateCourses",
        user: session.user,
        action: "course.create",
      });
    }
    return apiError(403, "Forbidden");
  }

  const parsedBody = await parseCreateCourseBody(
    request,
    session.user.role === "INSTRUCTOR"
      ? { forceInstructorUserIds: [session.user.id] }
      : undefined,
  );
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const result = { success: true as const, data: parsedBody.data };

  // §541: department must be a known discipline. The FK enforces this too, but
  // an explicit check returns a clean 400 instead of a raw constraint error.
  const deptGuard = await assertValidDepartment(result.data.department);
  if (deptGuard) return deptGuard;

  // §5/§19 unit lock: a UNIT_ADMIN can only create courses inside their
  // authorized units — a missing department is never a match.
  if (session.user.role === "UNIT_ADMIN") {
    const units = await getAuthorizedUnits(session.user);
    if (!result.data.department || !units.includes(result.data.department)) {
      return apiError(403, "DEPARTMENT_NOT_AUTHORIZED");
    }
  }

  const instructors = await prisma.user.findMany({
    where: {
      id: { in: result.data.instructorUserIds },
      role: "INSTRUCTOR",
    },
    select: { id: true },
  });

  if (instructors.length !== result.data.instructorUserIds.length) {
    return apiError(422, "INVALID_INSTRUCTOR");
  }

  const course = await prisma.$transaction(async (tx) => {
    const created = await tx.course.create({
      data: {
        name: result.data.name,
        code: result.data.code,
        section: result.data.section,
        term: result.data.term,
        year: result.data.year,
        startDate: result.data.startDate,
        endDate: result.data.endDate,
        department: result.data.department,
        description: result.data.description,
        isPublished: result.data.isPublished,
        aiInstructions: result.data.aiInstructions,
        instructorId: result.data.instructorUserIds[0],
      },
    });

    await tx.enrollment.createMany({
      data: result.data.instructorUserIds.map((userId) => ({
        courseId: created.id,
        userId,
        role: "INSTRUCTOR" as const,
        isActive: true,
      })),
    });

    return created;
  });

  return jsonResponse(201, course);
}

/**
 * PATCH /api/courses/:id — update a course. Admits ADMIN, UNIT_ADMIN(D),
 * INSTRUCTOR(C) per §5 (rank >= 2).
 */
export async function updateCourse(request: Request, courseId: string) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  const user = session.user;

  const body = await request.json();
  const result = UpdateCourseSchema.safeParse(body);

  if (!result.success) {
    return validationErrorFromZod(result.error);
  }

  const { course, access } = await resolveCourseAccessWithCourse(
    user,
    courseId,
  );

  if (!course) {
    return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  // TA carve-out (tas.canSetAiInstructions, grant): a TA may PATCH the
  // `aiInstructions` field ONLY, and only when the flag is on. Any other field
  // in the payload — or the flag being off — keeps the existing 403, so the
  // grant cannot be ridden into editing the rest of the course.
  if (access && access.level === "ta") {
    const taCanSetAi = await getPolicy("tas.canSetAiInstructions");
    const keys = Object.keys(result.data);
    const aiInstructionsOnly =
      keys.length > 0 && keys.every((key) => key === "aiInstructions");
    if (!taCanSetAi || !aiInstructionsOnly) {
      return denyByPolicy({
        request,
        policyKey: "tas.canSetAiInstructions",
        user,
        action: "course.update",
        courseId,
      });
    }
    const updated = await prisma.course.update({
      where: { id: courseId },
      data: {
        aiInstructions: result.data.aiInstructions,
      },
    });
    return new Response(JSON.stringify(updated), {
      status: 200,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  if (!access || access.rank < 2) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  // §6: only ADMIN / UNIT_ADMIN may reassign instructors or change department.
  const updateData: Partial<typeof result.data> = { ...result.data };
  if (access.rank < 3) {
    delete (updateData as any).instructorId;
    delete (updateData as any).department;
  }

  // §5: a UNIT_ADMIN cannot move a course to a unit outside their authorized
  // list (nor strip its department, which would orphan it from their scope).
  if (
    access.level === "unit" &&
    "department" in updateData &&
    updateData.department !== course.department
  ) {
    const units = await getAuthorizedUnits(user);
    if (!updateData.department || !units.includes(updateData.department)) {
      return new Response(
        JSON.stringify({ error: "DEPARTMENT_NOT_AUTHORIZED" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" } as const,
        },
      );
    }
  }

  // §541: a department change must target a known discipline (FK-backed).
  if ("department" in updateData && updateData.department) {
    const deptGuard = await assertValidDepartment(updateData.department);
    if (deptGuard) return deptGuard;
  }

  const newInstructorId = (updateData as any).instructorId as
    string | undefined;
  const instructorChanging =
    newInstructorId !== undefined && newInstructorId !== course.instructorId;

  const updated = await prisma.$transaction(async (tx) => {
    if (instructorChanging) {
      if (course.instructorId) {
        await tx.enrollment.updateMany({
          where: { courseId, userId: course.instructorId, role: "INSTRUCTOR" },
          data: { isActive: false },
        });
      }
      await tx.enrollment.upsert({
        where: { courseId_userId: { courseId, userId: newInstructorId! } },
        create: {
          courseId,
          userId: newInstructorId!,
          role: "INSTRUCTOR",
          isActive: true,
        },
        update: { role: "INSTRUCTOR", isActive: true },
      });
    }
    return tx.course.update({
      where: { id: courseId },
      data: updateData,
    });
  });

  return new Response(JSON.stringify(updated), {
    status: 200,
    headers: { "Content-Type": "application/json" } as const,
  });
}

/**
 * DELETE /api/courses/:id — soft-delete (sets `deletedAt`). Admits ADMIN,
 * UNIT_ADMIN(D), INSTRUCTOR(C) per §5.
 */
export async function deleteCourse(request: Request, courseId: string) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  const { course, access } = await resolveCourseAccessWithCourse(
    session.user,
    courseId,
  );

  if (!course) {
    return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  if (!access || access.rank < 2) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  // Policy gate: INSTRUCTOR delete is conditional; ADMIN/UNIT_ADMIN unaffected
  // by this flag (the service-key/enforceAdminIfApiKey path never reaches here
  // as an instructor).
  if (
    access.level === "instructor" &&
    !(await getPolicy("instructors.canDeleteCourses"))
  ) {
    return denyByPolicy({
      request,
      policyKey: "instructors.canDeleteCourses",
      user: session.user,
      action: "course.delete",
      courseId,
    });
  }

  // Policy gate: UNIT_ADMIN delete is conditional; ADMIN is always allowed.
  if (
    access.level === "unit" &&
    !(await getPolicy("unitAdmins.canDeleteCourses"))
  ) {
    return denyByPolicy({
      request,
      policyKey: "unitAdmins.canDeleteCourses",
      user: session.user,
      action: "course.delete",
      courseId,
    });
  }

  await prisma.course.update({
    where: { id: courseId },
    data: { deletedAt: new Date() },
  });

  // Best-effort cascade to extensions (§802) — fire-and-forget so it never blocks
  // the delete response; failures are logged and self-heal via each extension's
  // reconcile job. cascadeDeleteToExtensions never throws (each push is wrapped
  // in try/catch + logSystemError), so there's no unhandled-rejection risk.
  void cascadeDeleteToExtensions(courseId);

  return new Response(null, { status: 204 });
}

/**
 * PATCH /api/courses/:id/publish|unpublish — set published state (§5).
 * Accepts service key (extensions) or user session (ADMIN / UNIT_ADMIN(D) /
 * INSTRUCTOR(C) — rank >= 2, same gate as updateCourse).
 */
export async function setPublishState(
  request: Request,
  courseId: string,
  publish: boolean,
) {
  // Service key path: trusted extensions (AI Tutor) call this with Bearer EDUAI_API_KEY.
  if (request.headers.get("Authorization")?.startsWith("Bearer ")) {
    const serviceKeyGuard = await requireServiceKey(request);
    if (serviceKeyGuard) return serviceKeyGuard;

    const course = await prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      select: { id: true },
    });
    if (!course) {
      return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
        status: 404,
        headers: { "Content-Type": "application/json" } as const,
      });
    }

    const updated = await prisma.course.update({
      where: { id: courseId },
      data: { isPublished: publish },
    });
    return new Response(JSON.stringify(updated), {
      status: 200,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  // User session path (admin UI / direct API access)
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  const { course, access } = await resolveCourseAccessWithCourse(
    session.user,
    courseId,
  );

  if (!course) {
    return new Response(JSON.stringify({ error: "COURSE_NOT_FOUND" }), {
      status: 404,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  if (!access || access.rank < 2) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" } as const,
    });
  }

  // Policy gate: an INSTRUCTOR may publish only when the flag is on; higher
  // ranks (ADMIN / UNIT_ADMIN) are always allowed.
  if (
    access.level === "instructor" &&
    !(await getPolicy("instructors.canPublishCourses"))
  ) {
    return denyByPolicy({
      request,
      policyKey: "instructors.canPublishCourses",
      user: session.user,
      action: "course.publish",
      courseId,
    });
  }

  const updated = await prisma.course.update({
    where: { id: courseId },
    data: { isPublished: publish },
  });
  return new Response(JSON.stringify(updated), {
    status: 200,
    headers: { "Content-Type": "application/json" } as const,
  });
}

export async function getCourse(courseId: string, includeDeleted = false) {
  return prisma.course.findFirst({
    where: { id: courseId, ...(includeDeleted ? {} : { deletedAt: null }) },
  });
}

/**
 * Returns the `code`s of courses the given user may select in chat.
 *
 * Admins can access every course; everyone else can access only courses they
 * teach, TA, or are actively enrolled in. Used to validate the persisted
 * `lastCourseCode` on restore so a course the user can no longer access is not
 * brought back (#420 review — scope to the user, not the whole database).
 */
export async function getAccessibleCourseCodes(user: {
  id: string;
  role: UserRole | string | null | undefined;
  authorizedUnits?: string[] | null;
}): Promise<string[]> {
  // Reuse the same scoping as GET /api/courses so UNIT_ADMINs (whose access is
  // unit-based, not enrollment-based) don't lose a saved lastCourseCode on chat
  // restore. Covers admin, unit, instructor, TA, and student access uniformly.
  const where = await buildCourseListFilter(user);
  const courses = await prisma.course.findMany({
    where,
    select: { code: true },
  });
  return courses.map((course) => course.code);
}

/** A course row plus the caller's enrollment role on it, as `listCoursesForUser` returns. */
type CourseWithCallerRole = Prisma.CourseGetPayload<object> & {
  callerEnrollmentRole: Prisma.EnrollmentGetPayload<object>["role"] | null;
};

/**
 * Data-only course listing for in-process server callers (the dashboard loader)
 * that already hold the session user and need the same access-scoped page +
 * `total` GET /api/courses returns, without an HTTP round trip.
 *
 * Mirrors the session path of {@link getCourses}: `buildCourseListFilter` access
 * scoping, an optional `isActive` narrowing, and the per-row caller-enrollment
 * annotation. It deliberately omits the `?ids=`/`?search=`/`includeDeleted`
 * lookup surfaces and the service-key path — those are HTTP-only concerns the
 * dashboard never uses. Pass `countOnly: true` for a `total`-only read: it skips
 * the page fetch and the enrollment annotation entirely and returns `courses: []`.
 */
export async function listCoursesForUser(
  // Same access-scoping input `buildCourseListFilter` takes (a session user
  // satisfies it) — deliberately its loose `RbacUser`, not `rbac/types`'.
  user: Parameters<typeof buildCourseListFilter>[0],
  opts: { page?: number; pageSize?: number; isActive?: boolean; countOnly?: boolean } = {},
) {
  const { page = 1, pageSize = 25, isActive, countOnly = false } = opts;

  const base = await buildCourseListFilter(user);
  const where: Prisma.CourseWhereInput =
    isActive === undefined ? base : { AND: [base, { isActive }] };

  if (countOnly) {
    return { courses: [] as CourseWithCallerRole[], total: await prisma.course.count({ where }) };
  }

  const [total, rows] = await prisma.$transaction([
    prisma.course.count({ where }),
    prisma.course.findMany({
      where,
      orderBy: { code: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  // No rows means no enrollment annotation to build — an `in: []` lookup would
  // round-trip to Postgres only to return nothing.
  if (rows.length === 0) {
    return { courses: rows.map((course) => ({ ...course, callerEnrollmentRole: null })), total };
  }

  const enrollmentRows = await prisma.enrollment.findMany({
    where: {
      userId: user.id,
      isActive: true,
      courseId: { in: rows.map((course) => course.id) },
    },
    select: { courseId: true, role: true },
  });
  const roleByCourseId = new Map(
    enrollmentRows.map((row) => [row.courseId, row.role]),
  );
  const courses = rows.map((course) => ({
    ...course,
    callerEnrollmentRole: roleByCourseId.get(course.id) ?? null,
  }));

  return { courses, total };
}

/**
 * Returns only the RAG-tuning fields for a course.
 * Both fields are nullable — callers should fall back to global defaults when null.
 *
 * Results are cached in-memory for COURSE_RAG_SETTINGS_CACHE_TTL_MS (default 60 min)
 * to avoid a DB round-trip on every RAG query. Call invalidateCourseRagSettingsCache()
 * after any write to keep the cache consistent.
 */
export async function getCourseRagSettings(
  courseId: string,
): Promise<{
  ragTopK: number | null;
  ragSimilarityThreshold: number | null;
} | null> {
  pruneRagSettingsCache();

  const now = Date.now();
  const cached = ragSettingsCache.get(courseId);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await prisma.course.findUnique({
    where: { id: courseId },
    select: { ragTopK: true, ragSimilarityThreshold: true },
  });

  ragSettingsCache.set(courseId, {
    value,
    expiresAt: now + COURSE_RAG_SETTINGS_CACHE_TTL_MS,
  });
  return value;
}

export async function getCourseTopics(
  courseId: string,
  includeDeleted = false,
) {
  return prisma.courseTopic.findMany({
    where: { courseId, ...(includeDeleted ? {} : { deletedAt: null }) },
    orderBy: { name: "asc" },
  });
}

export async function getCourseTopic(
  courseId: string,
  topicId: string,
  includeDeleted = false,
) {
  return prisma.courseTopic.findFirst({
    where: {
      id: topicId,
      courseId,
      ...(includeDeleted ? {} : { deletedAt: null }),
    },
  });
}

export async function createCourseTopic(
  courseId: string,
  payload: CreateCourseTopicInput,
  // #294: null on the service-key path (no user); routes treat a null
  // createdBy as "no owner — TA delete not permitted".
  createdBy: string | null = null,
) {
  const parsed = CreateCourseTopicSchema.safeParse(payload);

  if (!parsed.success) {
    return {
      status: "400",
      details: parsed.error.flatten(),
    } as const;
  }

  const course = await prisma.course.findFirst({
    where: { id: courseId, deletedAt: null },
    select: { id: true },
  });
  if (!course) {
    return { status: "404" } as const;
  }

  try {
    const topic = await prisma.courseTopic.create({
      data: {
        courseId,
        name: parsed.data.name.trim(),
        createdBy,
      },
    });

    invalidateCourseTopicNamesCache(courseId);
    return { status: "201", topic } as const;
  } catch (error: any) {
    if (error?.code === "P2002") {
      const existing = await prisma.courseTopic.findFirst({
        where: { courseId, name: parsed.data.name.trim(), deletedAt: null },
        select: { id: true },
      });
      return {
        status: "409",
        existingId: existing?.id ?? null,
      } as const;
    }
    throw error;
  }
}

export async function updateCourseTopic(
  courseId: string,
  topicId: string,
  payload: UpdateCourseTopicInput,
) {
  const parsed = UpdateCourseTopicSchema.safeParse(payload);

  if (!parsed.success) {
    return {
      status: "400",
      details: parsed.error.flatten(),
    } as const;
  }

  const existing = await prisma.courseTopic.findFirst({
    where: { id: topicId, courseId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) {
    return { status: "404" } as const;
  }

  try {
    const topic = await prisma.courseTopic.update({
      where: { id: topicId },
      data: { name: parsed.data.name.trim() },
    });
    invalidateCourseTopicNamesCache(courseId);
    return { status: "200", topic } as const;
  } catch (error: any) {
    if (error?.code === "P2002") {
      const duplicate = await prisma.courseTopic.findFirst({
        where: { courseId, name: parsed.data.name.trim(), deletedAt: null },
        select: { id: true },
      });
      return {
        status: "409",
        existingId: duplicate?.id ?? null,
      } as const;
    }
    throw error;
  }
}

export async function deleteCourseTopic(
  courseId: string,
  payload: DeleteCourseTopicInput,
  deletedBy?: string | null,
) {
  const parsed = DeleteCourseTopicSchema.safeParse(payload);

  if (!parsed.success) {
    return {
      status: "400",
      details: parsed.error.flatten(),
    } as const;
  }

  const { topicId, name } = parsed.data;

  // Resolve the concrete row first so the deleted topic's id and name are
  // available for the audit log regardless of whether the caller passed an id
  // or a name (a soft delete leaves nothing to read back afterwards).
  const target = await prisma.courseTopic.findFirst({
    where: {
      courseId,
      deletedAt: null,
      ...(topicId ? { id: topicId } : {}),
      ...(name ? { name } : {}),
    },
    select: { id: true, name: true },
  });

  if (!target) {
    return { status: "404" } as const;
  }

  await prisma.courseTopic.update({
    where: { id: target.id },
    data: { deletedAt: new Date(), deletedBy: deletedBy || null },
  });

  invalidateCourseTopicNamesCache(courseId);
  return { status: "204", topic: target } as const;
}
