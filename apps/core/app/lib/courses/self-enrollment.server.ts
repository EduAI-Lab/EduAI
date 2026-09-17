/**
 * Self-enrollment links (#1756).
 *
 * Course staff mint a link; a signed-in student opens it and is enrolled as a
 * STUDENT of that one course. The link is a bearer credential, so every design
 * decision here follows from that:
 *
 *   - It is a ROW (`SelfEnrollmentLink`), not a stateless signed token. A leaked
 *     link has to be stoppable on its own, right now. A stateless HMAC over
 *     courseId+expiry could only be stopped by rotating the signing secret —
 *     which kills every other course's links — or by waiting out the expiry.
 *   - Only the sha256 of the token is stored, mirroring `Invitation.tokenHash`.
 *     The raw token exists in the share URL and nowhere else, so a database
 *     leak yields nothing redeemable.
 *   - Redemption always grants STUDENT. There is no role input anywhere in this
 *     module: a link that could mint a TA or an INSTRUCTOR would turn a
 *     forwarded URL into privilege escalation.
 *   - The enrollment write goes through `addEnrollment`, so the instructor-floor
 *     invariant, the reactivate-on-conflict behaviour and the `canAddEnrollmentRole`
 *     rank check all still apply.
 */
import prisma from "~/lib/prisma.server";
import { addEnrollment, requiredRankForEnrollmentRole } from "~/lib/courses/enrollments.server";
// Same primitive as platform invitations: a 256-bit URL-safe random token plus
// its digest. One generator, so both bearer credentials have the same entropy.
import { generateInviteToken, hashToken } from "~/lib/invitations/token.server";

/** A link with no explicit window lasts a month — about one teaching block. */
export const DEFAULT_LINK_TTL_DAYS = 30;
/** Hard ceiling. An "expires in ten years" link is indistinguishable from none. */
export const MAX_LINK_TTL_DAYS = 365;
/** Hard ceiling on the optional redemption cap; far above any real section. */
export const MAX_LINK_REDEMPTIONS = 10_000;

/**
 * Self-enrollment grants exactly this and nothing else. Declared once so there
 * is no call site where a different role could be passed in.
 */
const SELF_ENROLLMENT_ROLE = "STUDENT";

/**
 * The rank redemption acts with. Derived from the §6 table rather than written
 * as a literal, so it can never drift into a rank that could add an INSTRUCTOR.
 */
const SELF_ENROLLMENT_ACTOR_RANK = requiredRankForEnrollmentRole(SELF_ENROLLMENT_ROLE);

const MS_PER_DAY = 86_400_000;

/** The page that redeems a link. Kept next to the URL builder that points at it. */
const REDEEM_PATH = "/courses/self-enroll";

/** Build the shareable URL for a freshly minted token. */
export function selfEnrollmentUrl(origin: string, token: string): string {
  return `${origin}${REDEEM_PATH}?token=${encodeURIComponent(token)}`;
}

export type SelfEnrollmentLinkStatus = "ACTIVE" | "REVOKED" | "EXPIRED" | "EXHAUSTED";

/** What a staff member may see about a link. Never includes the hash. */
export type SelfEnrollmentLinkView = {
  id: string;
  status: SelfEnrollmentLinkStatus;
  expiresAt: Date;
  revokedAt: Date | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  createdAt: Date;
};

type LinkRow = {
  id: string;
  courseId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  createdAt: Date;
};

/** Exactly the columns the views and the checks below read — never `tokenHash`. */
const LINK_SELECT = {
  id: true,
  courseId: true,
  expiresAt: true,
  revokedAt: true,
  maxRedemptions: true,
  redemptionCount: true,
  createdAt: true,
} as const;

function isExhausted(link: Pick<LinkRow, "maxRedemptions" | "redemptionCount">): boolean {
  return link.maxRedemptions !== null && link.redemptionCount >= link.maxRedemptions;
}

function linkStatus(link: LinkRow, now: Date): SelfEnrollmentLinkStatus {
  if (link.revokedAt) return "REVOKED";
  if (link.expiresAt <= now) return "EXPIRED";
  if (isExhausted(link)) return "EXHAUSTED";
  return "ACTIVE";
}

function toView(link: LinkRow, now: Date): SelfEnrollmentLinkView {
  return {
    id: link.id,
    status: linkStatus(link, now),
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    maxRedemptions: link.maxRedemptions,
    redemptionCount: link.redemptionCount,
    createdAt: link.createdAt,
  };
}

function isPositiveIntegerWithin(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= max;
}

export type CreateSelfEnrollmentLinkInput = {
  courseId: string;
  /** Null when the caller is a service context rather than a person. */
  createdById: string | null;
  ttlDays?: number;
  maxRedemptions?: number;
};

/**
 * Mint a link. The raw token comes back ONCE, in this return value — it is
 * never stored and can never be re-read, so a staff member who loses it mints a
 * new link (and revokes the old one).
 */
export async function createSelfEnrollmentLink(input: CreateSelfEnrollmentLinkInput) {
  const ttlDays = input.ttlDays ?? DEFAULT_LINK_TTL_DAYS;
  if (!isPositiveIntegerWithin(ttlDays, MAX_LINK_TTL_DAYS)) {
    // Annotated `string` rather than inferred: `as const` would otherwise pin
    // the result type to this exact sentence, making the copy part of the API.
    const message: string = `must be a whole number of days between 1 and ${MAX_LINK_TTL_DAYS}`;
    return { status: "422", error: "VALIDATION_ERROR", fields: { ttlDays: message } } as const;
  }
  if (
    input.maxRedemptions !== undefined &&
    !isPositiveIntegerWithin(input.maxRedemptions, MAX_LINK_REDEMPTIONS)
  ) {
    const message: string = `must be a whole number between 1 and ${MAX_LINK_REDEMPTIONS}`;
    return {
      status: "422",
      error: "VALIDATION_ERROR",
      fields: { maxRedemptions: message },
    } as const;
  }

  const { token, tokenHash } = generateInviteToken();
  const link = await prisma.selfEnrollmentLink.create({
    data: {
      courseId: input.courseId,
      tokenHash,
      expiresAt: new Date(Date.now() + ttlDays * MS_PER_DAY),
      maxRedemptions: input.maxRedemptions ?? null,
      createdById: input.createdById,
    },
    select: LINK_SELECT,
  });

  return { status: "201", token, link: toView(link, new Date()) } as const;
}

/** Every link ever minted for a course, newest first, with a derived status. */
export async function listSelfEnrollmentLinks(courseId: string) {
  const links = await prisma.selfEnrollmentLink.findMany({
    where: { courseId },
    select: LINK_SELECT,
    orderBy: { createdAt: "desc" },
  });
  const now = new Date();
  return links.map((link) => toView(link, now));
}

/**
 * Revoke a link. Scoped by `courseId` in the lookup itself, so a staff member
 * with access to one course cannot revoke another course's link by guessing an
 * id. Idempotent: re-revoking keeps the original timestamp.
 */
export async function revokeSelfEnrollmentLink(courseId: string, linkId: string) {
  const existing = await prisma.selfEnrollmentLink.findFirst({
    where: { id: linkId, courseId },
    select: LINK_SELECT,
  });
  if (!existing) return { status: "404" } as const;
  if (existing.revokedAt) return { status: "204", alreadyRevoked: true } as const;

  await prisma.selfEnrollmentLink.update({
    where: { id: linkId },
    data: { revokedAt: new Date() },
  });
  return { status: "204", alreadyRevoked: false } as const;
}

export type SelfEnrollmentRejection =
  | { status: "404"; error: "INVALID_TOKEN" }
  | { status: "404"; error: "COURSE_MISMATCH" }
  | { status: "404"; error: "COURSE_NOT_FOUND" }
  | { status: "403"; error: "LINK_REVOKED" }
  | { status: "403"; error: "COURSE_NOT_PUBLISHED" }
  | { status: "410"; error: "LINK_EXPIRED" };

type ResolvedLink = {
  ok: true;
  link: LinkRow;
  course: { id: string; code: string; name: string };
};

/**
 * Every check that both previewing and redeeming a token must pass, in one
 * place — the preview a student sees and the decision that actually enrolls
 * them can then never disagree about whether a link is usable.
 *
 * `expectedCourseId` is the course the caller believes it is joining. Supplying
 * it is what makes a token for course A unusable against course B.
 */
async function resolveSelfEnrollmentLink(
  token: string,
  expectedCourseId?: string,
): Promise<ResolvedLink | { ok: false; failure: SelfEnrollmentRejection }> {
  const invalid = {
    ok: false as const,
    failure: { status: "404", error: "INVALID_TOKEN" } as const,
  };
  if (token.trim() === "") return invalid;

  const link = await prisma.selfEnrollmentLink.findUnique({
    where: { tokenHash: hashToken(token) },
    select: LINK_SELECT,
  });
  if (!link) return invalid;

  if (expectedCourseId !== undefined && link.courseId !== expectedCourseId) {
    return { ok: false, failure: { status: "404", error: "COURSE_MISMATCH" } };
  }
  if (link.revokedAt) {
    return { ok: false, failure: { status: "403", error: "LINK_REVOKED" } };
  }
  if (link.expiresAt <= new Date()) {
    return { ok: false, failure: { status: "410", error: "LINK_EXPIRED" } };
  }

  const course = await prisma.course.findFirst({
    where: { id: link.courseId, deletedAt: null },
    select: { id: true, code: true, name: true, isPublished: true },
  });
  if (!course) {
    return { ok: false, failure: { status: "404", error: "COURSE_NOT_FOUND" } };
  }
  // A link outlives a course going back into draft. Self-enrollment is a
  // student-facing path, and students cannot see an unpublished course at all,
  // so the link must stop working for exactly as long as the course is hidden.
  if (!course.isPublished) {
    return { ok: false, failure: { status: "403", error: "COURSE_NOT_PUBLISHED" } };
  }

  return { ok: true, link, course: { id: course.id, code: course.code, name: course.name } };
}

/**
 * Read-only "is this link usable, and for what course" — for the landing page a
 * student sees before they click Join. Redeems nothing and burns no slot.
 */
export async function previewSelfEnrollmentLink(token: string) {
  const resolved = await resolveSelfEnrollmentLink(token);
  if (!resolved.ok) return { ok: false as const, error: resolved.failure.error };
  return {
    ok: true as const,
    courseId: resolved.course.id,
    courseCode: resolved.course.code,
    courseName: resolved.course.name,
  };
}

/**
 * Take one redemption slot, atomically.
 *
 * The cap has to hold under concurrent redemptions, so the row is locked and
 * re-read inside the transaction before the count is compared and incremented —
 * the same lock-then-decide shape `enrollments.server` uses for the instructor
 * floor. Revocation and expiry are re-checked here too, so a link revoked
 * between the resolve above and this write still cannot be redeemed.
 */
async function claimRedemptionSlot(linkId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id"
      FROM "self_enrollment_links"
      WHERE "id" = ${linkId}
      FOR UPDATE
    `;
    const fresh = await tx.selfEnrollmentLink.findUnique({
      where: { id: linkId },
      select: LINK_SELECT,
    });
    if (!fresh || fresh.revokedAt || fresh.expiresAt <= new Date() || isExhausted(fresh)) {
      return false;
    }
    await tx.selfEnrollmentLink.update({
      where: { id: linkId },
      data: { redemptionCount: { increment: 1 } },
    });
    return true;
  });
}

export type RedeemSelfEnrollmentInput = {
  token: string;
  userId: string;
  /** When set, the token must belong to this course or redemption is refused. */
  courseId?: string;
};

/**
 * Redeem a link for a signed-in user.
 *
 * Idempotent: a user who is already actively enrolled gets a 200 and no second
 * enrollment, and no redemption slot is consumed — re-opening the link from
 * a browser history entry must not silently use up a capped link.
 */
export async function redeemSelfEnrollmentLink(input: RedeemSelfEnrollmentInput) {
  const resolved = await resolveSelfEnrollmentLink(input.token, input.courseId);
  if (!resolved.ok) return resolved.failure;
  const { course } = resolved;

  const existing = await prisma.enrollment.findUnique({
    where: { courseId_userId: { courseId: course.id, userId: input.userId } },
    select: { id: true, isActive: true },
  });
  if (existing?.isActive) {
    return {
      status: "200",
      courseId: course.id,
      enrollmentId: existing.id,
      alreadyEnrolled: true,
    } as const;
  }

  if (!(await claimRedemptionSlot(resolved.link.id))) {
    return { status: "409", error: "LINK_EXHAUSTED" } as const;
  }

  const result = await addEnrollment(
    course.id,
    { userId: input.userId, role: SELF_ENROLLMENT_ROLE },
    SELF_ENROLLMENT_ACTOR_RANK,
  );
  if (result.status === "201") {
    return {
      status: "201",
      courseId: course.id,
      enrollmentId: result.enrollment.id,
      alreadyEnrolled: false,
    } as const;
  }
  if (result.status === "409") {
    // A concurrent redemption won the race. The user is enrolled either way,
    // which is the outcome they asked for — the only cost is one slot counted
    // against a capped link, which we accept over reporting a false failure.
    return {
      status: "200",
      courseId: course.id,
      enrollmentId: null,
      alreadyEnrolled: true,
    } as const;
  }
  return { status: "422", error: result.error } as const;
}
