// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    selfEnrollmentLink: { findUnique: vi.fn(), update: vi.fn() },
  };
  return {
    selfEnrollmentLink: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      // `releaseRedemptionSlot` hands a claimed slot back through `updateMany`,
      // which no-ops rather than throwing when the row is already gone.
      updateMany: vi.fn(),
    },
    course: { findFirst: vi.fn() },
    enrollment: { findUnique: vi.fn() },
    $transaction: vi.fn(async <T>(run: (t: typeof tx) => Promise<T>) => run(tx)),
    __tx: tx,
  };
});

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

// `addEnrollment` is stubbed; the rank helpers stay real so redemption is
// pinned to the same §6 rule table the REST path uses.
vi.mock("~/lib/courses/enrollments.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/courses/enrollments.server")>();
  return { ...actual, addEnrollment: vi.fn() };
});

import {
  createSelfEnrollmentLink,
  listSelfEnrollmentLinks,
  previewSelfEnrollmentLink,
  redeemSelfEnrollmentLink,
  revokeSelfEnrollmentLink,
  selfEnrollmentUrl,
  DEFAULT_LINK_TTL_DAYS,
  MAX_LINK_TTL_DAYS,
  MAX_LINK_REDEMPTIONS,
} from "~/lib/courses/self-enrollment.server";
import { addEnrollment } from "~/lib/courses/enrollments.server";
import { hashToken } from "~/lib/invitations/token.server";

const tx = prismaMock.__tx;
const addEnrollmentMock = vi.mocked(addEnrollment);

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 60 * 1000);

const PUBLISHED_COURSE = {
  id: "course-1",
  code: "COSC 111",
  name: "Intro to CS",
  isPublished: true,
  deletedAt: null,
};

/** The `SelfEnrollmentLink` columns this suite stands in for. */
type LinkRowFixture = {
  id: string;
  courseId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** What the library writes on create — asserted on directly by the tests below. */
type CreateLinkData = Pick<
  LinkRowFixture,
  "courseId" | "tokenHash" | "expiresAt" | "maxRedemptions" | "createdById"
>;

function linkRow(overrides: Partial<LinkRowFixture> = {}): LinkRowFixture {
  return {
    id: "link-1",
    courseId: "course-1",
    tokenHash: hashToken("raw-token"),
    expiresAt: FUTURE,
    revokedAt: null,
    maxRedemptions: null,
    redemptionCount: 0,
    createdById: "instructor-1",
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** Default happy path: a live link, a published course, nobody enrolled yet. */
function mockLiveLink(overrides: Partial<LinkRowFixture> = {}) {
  const row = linkRow(overrides);
  prismaMock.selfEnrollmentLink.findUnique.mockResolvedValue(row);
  prismaMock.course.findFirst.mockResolvedValue(PUBLISHED_COURSE);
  prismaMock.enrollment.findUnique.mockResolvedValue(null);
  tx.selfEnrollmentLink.findUnique.mockResolvedValue(row);
  tx.selfEnrollmentLink.update.mockResolvedValue({ ...row, redemptionCount: 1 });
  return row;
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.$queryRaw.mockResolvedValue([]);
  // `$transaction`'s implementation comes from `vi.fn(impl)` above and survives
  // `clearAllMocks`, which only drops recorded calls.
  addEnrollmentMock.mockResolvedValue({
    status: "201",
    enrollment: { id: "enr-1", userId: "student-1", role: "STUDENT" },
  } as Awaited<ReturnType<typeof addEnrollment>>);
});

describe("selfEnrollmentUrl", () => {
  it("builds the redemption URL the instructor shares", () => {
    expect(selfEnrollmentUrl("https://eduai.test", "abc123")).toBe(
      "https://eduai.test/courses/self-enroll?token=abc123",
    );
  });

  it("URL-encodes the token", () => {
    expect(selfEnrollmentUrl("https://eduai.test", "a b&c")).toContain("token=a%20b%26c");
  });
});

describe("createSelfEnrollmentLink", () => {
  it("persists only the hash and hands the raw token back exactly once", async () => {
    prismaMock.selfEnrollmentLink.create.mockImplementation(
      async ({ data }: { data: CreateLinkData }) => ({ ...linkRow(), ...data }),
    );

    const result = await createSelfEnrollmentLink({
      courseId: "course-1",
      createdById: "instructor-1",
    });

    if (result.status !== "201") throw new Error(`expected 201, got ${result.status}`);
    expect(result.token).toEqual(expect.any(String));
    const persisted = prismaMock.selfEnrollmentLink.create.mock.calls[0][0].data;
    expect(persisted.tokenHash).toBe(hashToken(result.token));
    // The raw token must never appear in any persisted column.
    expect(JSON.stringify(persisted)).not.toContain(result.token);
  });

  it("defaults the expiry to DEFAULT_LINK_TTL_DAYS and leaves redemptions unlimited", async () => {
    prismaMock.selfEnrollmentLink.create.mockImplementation(
      async ({ data }: { data: CreateLinkData }) => ({ ...linkRow(), ...data }),
    );

    const before = Date.now();
    await createSelfEnrollmentLink({ courseId: "course-1", createdById: "instructor-1" });
    const persisted = prismaMock.selfEnrollmentLink.create.mock.calls[0][0].data;

    const ttlMs = persisted.expiresAt.getTime() - before;
    expect(ttlMs).toBeGreaterThan((DEFAULT_LINK_TTL_DAYS - 1) * 86_400_000);
    expect(ttlMs).toBeLessThanOrEqual(DEFAULT_LINK_TTL_DAYS * 86_400_000 + 5_000);
    expect(persisted.maxRedemptions).toBeNull();
  });

  it("rejects a non-positive or over-long expiry window", async () => {
    for (const ttlDays of [0, -1, MAX_LINK_TTL_DAYS + 1, 1.5]) {
      const result = await createSelfEnrollmentLink({
        courseId: "course-1",
        createdById: "instructor-1",
        ttlDays,
      });
      expect(result.status).toBe("422");
    }
    expect(prismaMock.selfEnrollmentLink.create).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range redemption cap", async () => {
    for (const maxRedemptions of [0, -5, MAX_LINK_REDEMPTIONS + 1, 2.5]) {
      const result = await createSelfEnrollmentLink({
        courseId: "course-1",
        createdById: "instructor-1",
        maxRedemptions,
      });
      expect(result.status).toBe("422");
    }
    expect(prismaMock.selfEnrollmentLink.create).not.toHaveBeenCalled();
  });

  it("stores an in-range redemption cap", async () => {
    prismaMock.selfEnrollmentLink.create.mockImplementation(
      async ({ data }: { data: CreateLinkData }) => ({ ...linkRow(), ...data }),
    );
    await createSelfEnrollmentLink({
      courseId: "course-1",
      createdById: "instructor-1",
      maxRedemptions: 30,
    });
    expect(prismaMock.selfEnrollmentLink.create.mock.calls[0][0].data.maxRedemptions).toBe(30);
  });
});

describe("listSelfEnrollmentLinks", () => {
  it("derives a status per link and never returns the hash", async () => {
    prismaMock.selfEnrollmentLink.findMany.mockResolvedValue([
      linkRow({ id: "live" }),
      linkRow({ id: "revoked", revokedAt: PAST }),
      linkRow({ id: "expired", expiresAt: PAST }),
      linkRow({ id: "used-up", maxRedemptions: 2, redemptionCount: 2 }),
    ]);

    const links = await listSelfEnrollmentLinks("course-1");

    expect(links.map((l) => [l.id, l.status])).toEqual([
      ["live", "ACTIVE"],
      ["revoked", "REVOKED"],
      ["expired", "EXPIRED"],
      ["used-up", "EXHAUSTED"],
    ]);
    expect(JSON.stringify(links)).not.toContain("tokenHash");
  });
});

describe("revokeSelfEnrollmentLink", () => {
  it("404s a link that belongs to another course", async () => {
    prismaMock.selfEnrollmentLink.findFirst.mockResolvedValue(null);
    const result = await revokeSelfEnrollmentLink("course-2", "link-1");
    expect(result.status).toBe("404");
    expect(prismaMock.selfEnrollmentLink.update).not.toHaveBeenCalled();
    // The course id must be part of the lookup, not checked after the fact.
    expect(prismaMock.selfEnrollmentLink.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "link-1", courseId: "course-2" } }),
    );
  });

  it("stamps revokedAt so the link stops redeeming immediately", async () => {
    prismaMock.selfEnrollmentLink.findFirst.mockResolvedValue(linkRow());
    prismaMock.selfEnrollmentLink.update.mockResolvedValue(linkRow({ revokedAt: new Date() }));

    const result = await revokeSelfEnrollmentLink("course-1", "link-1");

    expect(result.status).toBe("204");
    expect(prismaMock.selfEnrollmentLink.update).toHaveBeenCalledWith({
      where: { id: "link-1" },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("is idempotent — revoking an already-revoked link does not re-stamp it", async () => {
    const revokedAt = new Date("2026-09-10T00:00:00.000Z");
    prismaMock.selfEnrollmentLink.findFirst.mockResolvedValue(linkRow({ revokedAt }));

    const result = await revokeSelfEnrollmentLink("course-1", "link-1");

    expect(result.status).toBe("204");
    expect(prismaMock.selfEnrollmentLink.update).not.toHaveBeenCalled();
  });
});

describe("redeemSelfEnrollmentLink — rejections", () => {
  it("rejects an unknown token", async () => {
    prismaMock.selfEnrollmentLink.findUnique.mockResolvedValue(null);
    const result = await redeemSelfEnrollmentLink({ token: "nope", userId: "student-1" });
    expect(result).toEqual({ status: "404", error: "INVALID_TOKEN" });
    expect(addEnrollmentMock).not.toHaveBeenCalled();
  });

  it("rejects a blank token without hitting the database", async () => {
    const result = await redeemSelfEnrollmentLink({ token: "   ", userId: "student-1" });
    expect(result).toEqual({ status: "404", error: "INVALID_TOKEN" });
    expect(prismaMock.selfEnrollmentLink.findUnique).not.toHaveBeenCalled();
  });

  it("looks the token up by hash, never by its raw value", async () => {
    mockLiveLink();
    await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });
    expect(prismaMock.selfEnrollmentLink.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashToken("raw-token") } }),
    );
  });

  it("rejects a token issued for a different course", async () => {
    mockLiveLink({ courseId: "course-1" });
    const result = await redeemSelfEnrollmentLink({
      token: "raw-token",
      userId: "student-1",
      courseId: "course-2",
    });
    expect(result).toEqual({ status: "404", error: "COURSE_MISMATCH" });
    expect(addEnrollmentMock).not.toHaveBeenCalled();
  });

  it("rejects a revoked token even while its expiry window is still open", async () => {
    mockLiveLink({ revokedAt: PAST, expiresAt: FUTURE });
    const result = await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });
    expect(result).toEqual({ status: "403", error: "LINK_REVOKED" });
    expect(addEnrollmentMock).not.toHaveBeenCalled();
  });

  it("rejects an expired token", async () => {
    mockLiveLink({ expiresAt: PAST });
    const result = await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });
    expect(result).toEqual({ status: "410", error: "LINK_EXPIRED" });
    expect(addEnrollmentMock).not.toHaveBeenCalled();
  });

  it("rejects a token for an unpublished course", async () => {
    mockLiveLink();
    prismaMock.course.findFirst.mockResolvedValue({ ...PUBLISHED_COURSE, isPublished: false });
    const result = await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });
    expect(result).toEqual({ status: "403", error: "COURSE_NOT_PUBLISHED" });
    expect(addEnrollmentMock).not.toHaveBeenCalled();
  });

  it("rejects a token whose course was deleted", async () => {
    mockLiveLink();
    prismaMock.course.findFirst.mockResolvedValue(null);
    const result = await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });
    expect(result).toEqual({ status: "404", error: "COURSE_NOT_FOUND" });
  });

  it("rejects a token that has hit its redemption cap", async () => {
    const row = linkRow({ maxRedemptions: 2, redemptionCount: 2 });
    prismaMock.selfEnrollmentLink.findUnique.mockResolvedValue(row);
    prismaMock.course.findFirst.mockResolvedValue(PUBLISHED_COURSE);
    prismaMock.enrollment.findUnique.mockResolvedValue(null);
    tx.selfEnrollmentLink.findUnique.mockResolvedValue(row);

    const result = await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });

    expect(result).toEqual({ status: "409", error: "LINK_EXHAUSTED" });
    expect(tx.selfEnrollmentLink.update).not.toHaveBeenCalled();
    expect(addEnrollmentMock).not.toHaveBeenCalled();
  });
});

/**
 * A link can change between the preview a student is looking at and the moment
 * they click Join. The locked re-check is the only place that sees it happen,
 * so it has to report WHICH thing changed — telling a student whose link was
 * just revoked that it "reached its limit" sends them to ask for a bigger cap
 * for a link that will never work again.
 */
describe("redeemSelfEnrollmentLink — the link changes mid-session", () => {
  /** Live at resolve time, something else by the time the row is locked. */
  function mockChangedUnderLock(fresh: LinkRowFixture | null) {
    mockLiveLink();
    tx.selfEnrollmentLink.findUnique.mockResolvedValue(fresh);
  }

  it("reports a revocation as LINK_REVOKED, not LINK_EXHAUSTED", async () => {
    // Expiry deliberately still open, so a 403 here can only come from the
    // revocation rather than from a link that lapsed on its own.
    mockChangedUnderLock(linkRow({ revokedAt: new Date(), expiresAt: FUTURE }));

    const result = await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });

    expect(result).toEqual({ status: "403", error: "LINK_REVOKED" });
    expect(tx.selfEnrollmentLink.update).not.toHaveBeenCalled();
    expect(addEnrollmentMock).not.toHaveBeenCalled();
  });

  it("reports an expiry as LINK_EXPIRED", async () => {
    mockChangedUnderLock(linkRow({ expiresAt: PAST }));
    const result = await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });
    expect(result).toEqual({ status: "410", error: "LINK_EXPIRED" });
    expect(addEnrollmentMock).not.toHaveBeenCalled();
  });

  it("reports a cap reached under the lock as LINK_EXHAUSTED", async () => {
    mockChangedUnderLock(linkRow({ maxRedemptions: 1, redemptionCount: 1 }));
    const result = await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });
    expect(result).toEqual({ status: "409", error: "LINK_EXHAUSTED" });
    expect(addEnrollmentMock).not.toHaveBeenCalled();
  });

  it("reports a link deleted under the lock as INVALID_TOKEN", async () => {
    mockChangedUnderLock(null);
    const result = await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });
    expect(result).toEqual({ status: "404", error: "INVALID_TOKEN" });
    expect(addEnrollmentMock).not.toHaveBeenCalled();
  });
});

/**
 * The slot is claimed in its own committed transaction before `addEnrollment`
 * runs, so a failure afterwards must not leave a capped link permanently one
 * redemption shorter with nobody enrolled for it.
 */
describe("redeemSelfEnrollmentLink — a spent slot follows the enrollment", () => {
  const releaseCall = {
    where: { id: "link-1", redemptionCount: { gt: 0 } },
    data: { redemptionCount: { decrement: 1 } },
  };

  it("gives the slot back when addEnrollment refuses", async () => {
    mockLiveLink({ maxRedemptions: 30 });
    addEnrollmentMock.mockResolvedValue({ status: "422", error: "USER_NOT_FOUND" } as Awaited<
      ReturnType<typeof addEnrollment>
    >);

    const result = await redeemSelfEnrollmentLink({ token: "raw-token", userId: "ghost" });

    expect(result).toEqual({ status: "422", error: "USER_NOT_FOUND" });
    expect(tx.selfEnrollmentLink.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.selfEnrollmentLink.updateMany).toHaveBeenCalledWith(releaseCall);
  });

  it("gives the slot back when addEnrollment throws, and rethrows", async () => {
    mockLiveLink({ maxRedemptions: 30 });
    addEnrollmentMock.mockRejectedValue(new Error("db hiccup"));

    await expect(
      redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" }),
    ).rejects.toThrow("db hiccup");

    expect(prismaMock.selfEnrollmentLink.updateMany).toHaveBeenCalledWith(releaseCall);
  });

  it("keeps the slot on a successful enrollment", async () => {
    mockLiveLink({ maxRedemptions: 30 });
    await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });
    expect(prismaMock.selfEnrollmentLink.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the slot when a concurrent redemption won the race", async () => {
    // The student ends up enrolled, which is what they asked for — one slot is
    // the accepted cost of not reporting a false failure.
    mockLiveLink({ maxRedemptions: 30 });
    addEnrollmentMock.mockResolvedValue({ status: "409", error: "ALREADY_ENROLLED" } as Awaited<
      ReturnType<typeof addEnrollment>
    >);

    const result = await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });

    expect(result).toMatchObject({ status: "200", alreadyEnrolled: true });
    expect(prismaMock.selfEnrollmentLink.updateMany).not.toHaveBeenCalled();
  });
});

describe("redeemSelfEnrollmentLink — an already-enrolled student re-opening the link", () => {
  // A self-enrollment URL lives in a syllabus page or a Canvas announcement, so
  // students who joined on day one re-click it for the rest of the term. The
  // link's own state must not turn that into an error page: they are enrolled,
  // the answer is the course. Usability is still enforced for everyone the
  // idempotency check does not cover — see the redeem-rejection suite above.
  it.each([
    ["exhausted", { maxRedemptions: 30, redemptionCount: 30 }],
    ["revoked", { revokedAt: PAST }],
    ["expired", { expiresAt: PAST }],
  ])("answers 200 rather than an error when the link is %s", async (_label, overrides) => {
    mockLiveLink(overrides);
    prismaMock.enrollment.findUnique.mockResolvedValue({ id: "enr-9", isActive: true });

    const result = await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });

    expect(result).toMatchObject({
      status: "200",
      courseId: "course-1",
      enrollmentId: "enr-9",
      alreadyEnrolled: true,
    });
    // Nothing written: no slot spent on a link that is out of them anyway, and
    // no release to undo.
    expect(tx.selfEnrollmentLink.update).not.toHaveBeenCalled();
    expect(prismaMock.selfEnrollmentLink.updateMany).not.toHaveBeenCalled();
    expect(addEnrollmentMock).not.toHaveBeenCalled();
  });

  it("still refuses a course that went back to draft, enrolled or not", async () => {
    // Deferring the *link's* usability does not defer the course's. A student
    // cannot see an unpublished course at all, so there is nowhere to send them.
    mockLiveLink({ maxRedemptions: 30, redemptionCount: 30 });
    prismaMock.course.findFirst.mockResolvedValue({ ...PUBLISHED_COURSE, isPublished: false });
    prismaMock.enrollment.findUnique.mockResolvedValue({ id: "enr-9", isActive: true });

    const result = await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });

    expect(result).toEqual({ status: "403", error: "COURSE_NOT_PUBLISHED" });
  });

  it("does not extend the same grace to a student who is not enrolled yet", async () => {
    // The guard is idempotency, not a weakening of the cap: a lapsed (inactive)
    // enrollment still has to pass through a usable link to come back.
    mockLiveLink({ maxRedemptions: 30, redemptionCount: 30 });
    prismaMock.enrollment.findUnique.mockResolvedValue({ id: "enr-9", isActive: false });

    const result = await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });

    expect(result).toEqual({ status: "409", error: "LINK_EXHAUSTED" });
    expect(addEnrollmentMock).not.toHaveBeenCalled();
  });
});

describe("redeemSelfEnrollmentLink — success", () => {
  it("enrolls the redeemer as a STUDENT and never as staff", async () => {
    mockLiveLink();
    const result = await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });

    expect(result).toMatchObject({ status: "201", courseId: "course-1", enrollmentId: "enr-1" });
    expect(addEnrollmentMock).toHaveBeenCalledTimes(1);
    const [courseId, payload, actorRank] = addEnrollmentMock.mock.calls[0];
    expect(courseId).toBe("course-1");
    expect(payload).toEqual({ userId: "student-1", role: "STUDENT" });
    // Rank 2 is `requiredRankForEnrollmentRole("STUDENT")` — enough to add a
    // student, never enough to add an INSTRUCTOR.
    expect(actorRank).toBe(2);
  });

  it("claims a redemption slot under a row lock before writing the enrollment", async () => {
    mockLiveLink({ maxRedemptions: 5, redemptionCount: 1 });
    await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.selfEnrollmentLink.update).toHaveBeenCalledWith({
      where: { id: "link-1" },
      data: { redemptionCount: { increment: 1 } },
    });
  });

  it("is idempotent: a second redemption neither duplicates nor burns a slot", async () => {
    mockLiveLink({ maxRedemptions: 5, redemptionCount: 1 });
    prismaMock.enrollment.findUnique.mockResolvedValue({ id: "enr-1", isActive: true });

    const result = await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });

    expect(result).toEqual({
      status: "200",
      courseId: "course-1",
      enrollmentId: "enr-1",
      linkId: "link-1",
      alreadyEnrolled: true,
    });
    expect(addEnrollmentMock).not.toHaveBeenCalled();
    expect(tx.selfEnrollmentLink.update).not.toHaveBeenCalled();
  });

  it("re-enrolls a student who was previously removed", async () => {
    mockLiveLink();
    prismaMock.enrollment.findUnique.mockResolvedValue({ id: "enr-old", isActive: false });

    const result = await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });

    expect(result).toMatchObject({ status: "201" });
    expect(addEnrollmentMock).toHaveBeenCalledTimes(1);
  });

  it("treats a concurrent duplicate enrollment as already-enrolled, not an error", async () => {
    mockLiveLink();
    addEnrollmentMock.mockResolvedValue({ status: "409", error: "ALREADY_ENROLLED" } as Awaited<
      ReturnType<typeof addEnrollment>
    >);

    const result = await redeemSelfEnrollmentLink({ token: "raw-token", userId: "student-1" });

    expect(result).toMatchObject({ status: "200", alreadyEnrolled: true });
  });
});

describe("previewSelfEnrollmentLink", () => {
  it("describes the course without redeeming anything", async () => {
    mockLiveLink();
    const result = await previewSelfEnrollmentLink("raw-token", "student-1");

    expect(result).toEqual({
      ok: true,
      alreadyEnrolled: false,
      courseId: "course-1",
      courseCode: "COSC 111",
      courseName: "Intro to CS",
    });
    expect(tx.selfEnrollmentLink.update).not.toHaveBeenCalled();
    expect(addEnrollmentMock).not.toHaveBeenCalled();
  });

  it("reports the same rejection codes the redeem path uses", async () => {
    mockLiveLink({ revokedAt: PAST });
    expect(await previewSelfEnrollmentLink("raw-token", "student-1")).toEqual({
      ok: false,
      error: "LINK_REVOKED",
    });

    mockLiveLink({ expiresAt: PAST });
    expect(await previewSelfEnrollmentLink("raw-token", "student-1")).toEqual({
      ok: false,
      error: "LINK_EXPIRED",
    });

    prismaMock.selfEnrollmentLink.findUnique.mockResolvedValue(null);
    expect(await previewSelfEnrollmentLink("raw-token", "student-1")).toEqual({
      ok: false,
      error: "INVALID_TOKEN",
    });
  });

  it("refuses an exhausted link up front instead of at the Join click", async () => {
    // A cap of 50 that has been redeemed 50 times. Student 51 must not be shown
    // "Join COSC 111" with a live button that can only answer 409 — preview and
    // redeem run the same usability check precisely so they cannot disagree.
    mockLiveLink({ maxRedemptions: 50, redemptionCount: 50 });

    expect(await previewSelfEnrollmentLink("raw-token", "student-1")).toEqual({
      ok: false,
      error: "LINK_EXHAUSTED",
    });
    expect(tx.selfEnrollmentLink.update).not.toHaveBeenCalled();
    expect(addEnrollmentMock).not.toHaveBeenCalled();
  });

  // The redeem path's idempotency guard is only reachable through the Join
  // button, and the Join button is only rendered when the preview says yes. So
  // the preview has to make the same allowance, or the already-enrolled student
  // never reaches the code that was fixed for them — they just read an error.
  describe("with a viewer, for an already-enrolled student", () => {
    it.each([
      ["exhausted", { maxRedemptions: 30, redemptionCount: 30 }],
      ["revoked", { revokedAt: PAST }],
      ["expired", { expiresAt: PAST }],
    ])("reports the course rather than refusing when the link is %s", async (_l, overrides) => {
      mockLiveLink(overrides);
      prismaMock.enrollment.findUnique.mockResolvedValue({ id: "enr-9", isActive: true });

      expect(await previewSelfEnrollmentLink("raw-token", "student-1")).toEqual({
        ok: true,
        alreadyEnrolled: true,
        courseId: "course-1",
        courseCode: "COSC 111",
        courseName: "Intro to CS",
      });
      expect(tx.selfEnrollmentLink.update).not.toHaveBeenCalled();
    });

    it("still refuses a student who is not enrolled yet", async () => {
      mockLiveLink({ maxRedemptions: 30, redemptionCount: 30 });
      prismaMock.enrollment.findUnique.mockResolvedValue(null);

      expect(await previewSelfEnrollmentLink("raw-token", "student-1")).toEqual({
        ok: false,
        error: "LINK_EXHAUSTED",
      });
    });

    it("reports a usable link as not-already-enrolled so the Join button still shows", async () => {
      mockLiveLink();
      prismaMock.enrollment.findUnique.mockResolvedValue(null);

      expect(await previewSelfEnrollmentLink("raw-token", "student-1")).toMatchObject({
        ok: true,
        alreadyEnrolled: false,
        courseId: "course-1",
      });
    });
  });
});
