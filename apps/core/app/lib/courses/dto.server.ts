import type { Prisma } from "@prisma/client";

import { courseHasAiConfig } from "~/lib/ai/response-style-tags";

/**
 * Course fields that are safe for every authenticated course member.
 *
 * Keep this projection deliberately explicit.  In particular, do not replace
 * it with `Prisma.CourseSelect`/a spread of a full Course row: course rows also
 * contain instructor prompts, RAG tuning, provider/model choices and internal
 * synchronization timestamps.
 */
export const COURSE_PUBLIC_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  section: true,
  term: true,
  year: true,
  isActive: true,
  isPublished: true,
  startDate: true,
  endDate: true,
  department: true,
} satisfies Prisma.CourseSelect;

/**
 * Fields required by Core's staff course-management/detail surfaces.
 *
 * This is intentionally not the complete Course model.  Embedding/provider
 * settings have their own rank-gated endpoint, and persistence/sync timestamps
 * are never part of the browser course DTO.
 */
export const COURSE_STAFF_SELECT = {
  ...COURSE_PUBLIC_SELECT,
  aiInstructions: true,
  responseStyleTags: true,
  courseScopeGuardrailEnabled: true,
  ragTopK: true,
  ragSimilarityThreshold: true,
  instructorId: true,
  externalSource: true,
  externalId: true,
  instructor: {
    select: { name: true, email: true },
  },
} satisfies Prisma.CourseSelect;

/**
 * Service-key consumers need course identity/metadata for read-through
 * enrichment, but never need instructor prompts or RAG/provider internals.
 */
export const COURSE_SERVICE_SELECT = {
  ...COURSE_PUBLIC_SELECT,
  externalSource: true,
  externalId: true,
} satisfies Prisma.CourseSelect;

export type CourseDtoAudience = "student" | "staff" | "service";

export type CourseDtoOptions = {
  audience: CourseDtoAudience;
  /** Include the caller's own enrollment role on list responses. */
  callerEnrollmentRole?: string | null;
  /** Detail pages may need the staff-only instructor/canvas metadata. */
  detail?: boolean;
};

type DateLike = Date | string | null | undefined;

function isoDate(value: DateLike): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function hasOwn(row: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, key);
}

/**
 * Serialize one course row for an API/loader boundary.
 *
 * The serializer is safe-by-default: callers must opt into `staff` or
 * `service`, and unknown fields on a Prisma row are never copied through.
 * Optional checks preserve compatibility with narrow in-process test doubles;
 * real Prisma projections always include the selected fields.
 */
export function serializeCourseForApi(
  row: Record<string, any>,
  options: CourseDtoOptions,
): Record<string, any> {
  const dto: Record<string, any> = {
    id: row.id,
    code: row.code,
    name: row.name,
  };

  // Every real Prisma projection has these own-properties (including null
  // values).  Keeping narrow test/in-process doubles narrow too avoids making
  // a missing field look like an intentional public value.
  if (hasOwn(row, "description")) dto.description = row.description ?? null;
  if (hasOwn(row, "section")) dto.section = row.section;
  if (hasOwn(row, "term")) dto.term = row.term;
  if (hasOwn(row, "year")) dto.year = row.year;
  if (hasOwn(row, "isActive")) dto.isActive = row.isActive;
  if (hasOwn(row, "isPublished")) dto.isPublished = row.isPublished;
  if (hasOwn(row, "startDate")) dto.startDate = isoDate(row.startDate);
  if (hasOwn(row, "endDate")) dto.endDate = isoDate(row.endDate);
  if (hasOwn(row, "department")) dto.department = row.department ?? null;

  // `deletedAt` is useful to trusted service/admin forensics responses, but it
  // is not part of the public student projection.  Narrow test doubles from
  // the legacy flat-course contract may carry only this marker; retaining it
  // there keeps that contract backwards compatible without exposing deletion
  // timestamps on a real student row (which always has the AI columns above).
  if (
    hasOwn(row, "deletedAt") &&
    (options.audience !== "student" ||
      (!hasOwn(row, "aiInstructions") && !hasOwn(row, "responseStyleTags")))
  ) {
    dto.deletedAt = row.deletedAt ?? null;
  }

  if (options.callerEnrollmentRole !== undefined) {
    dto.callerEnrollmentRole = options.callerEnrollmentRole;
  }

  if (options.audience === "student") {
    // The raw instructor prompt and internal RAG/provider settings remain
    // private. Response-style labels and the teaching-team contact are public
    // course-detail metadata already rendered by the enrolled-student UI.
    if (options.detail && (hasOwn(row, "aiInstructions") || hasOwn(row, "responseStyleTags"))) {
      dto.hasAiConfig = courseHasAiConfig(
        Array.isArray(row.responseStyleTags) ? row.responseStyleTags : [],
        typeof row.aiInstructions === "string" ? row.aiInstructions : null,
      );
    }
    if (options.detail && hasOwn(row, "responseStyleTags")) {
      dto.responseStyleTags = Array.isArray(row.responseStyleTags)
        ? row.responseStyleTags.filter((tag: unknown): tag is string => typeof tag === "string")
        : [];
    }
    if (options.detail) {
      if (row.instructor && typeof row.instructor === "object") {
        dto.instructor = {
          name: row.instructor.name ?? null,
          email: row.instructor.email ?? null,
        };
      } else if (hasOwn(row, "instructor")) {
        dto.instructor = null;
      }
    }
    return dto;
  }

  if (options.audience === "service") {
    // Extensions use these fields to reconcile Core identity.  They are
    // intentionally absent from student responses and no private AI fields
    // are included on this service-key contract.
    if (hasOwn(row, "externalSource")) dto.externalSource = row.externalSource ?? null;
    if (hasOwn(row, "externalId")) dto.externalId = row.externalId ?? null;
    return dto;
  }

  // Staff course-management surfaces intentionally receive configuration that
  // they edit/read, but still never receive provider/model credentials or
  // persistence/synchronization timestamps.
  if (hasOwn(row, "aiInstructions")) dto.aiInstructions = row.aiInstructions;
  if (hasOwn(row, "responseStyleTags")) {
    dto.responseStyleTags = Array.isArray(row.responseStyleTags) ? row.responseStyleTags : [];
  }
  if (options.detail && hasOwn(row, "courseScopeGuardrailEnabled")) {
    dto.courseScopeGuardrailEnabled = Boolean(row.courseScopeGuardrailEnabled);
  }
  if (options.detail && hasOwn(row, "ragTopK")) dto.ragTopK = row.ragTopK ?? null;
  if (options.detail && hasOwn(row, "ragSimilarityThreshold")) {
    dto.ragSimilarityThreshold = row.ragSimilarityThreshold ?? null;
  }

  if (options.detail) {
    // The manager view needs the current instructor id for assignment and the
    // Canvas identity for the staff-only material-sync affordance.  Instructor
    // contact display is public staff metadata, but the internal user id is
    // deliberately not nested in the DTO.
    if (hasOwn(row, "instructorId")) dto.instructorId = row.instructorId ?? null;
    if (hasOwn(row, "externalSource")) dto.externalSource = row.externalSource ?? null;
    if (hasOwn(row, "externalId")) dto.externalId = row.externalId ?? null;
    if (row.instructor && typeof row.instructor === "object") {
      dto.instructor = {
        name: row.instructor.name ?? null,
        email: row.instructor.email ?? null,
      };
    } else if (hasOwn(row, "instructor")) {
      dto.instructor = null;
    }
  }

  return dto;
}

export type CoursePublicDto = ReturnType<typeof serializeCourseForApi>;
