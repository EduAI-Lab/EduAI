// @vitest-environment node
// #1961 — joins started from a self-enrollment link before the account was
// activated: remembered against the account (link id, never the token), then
// redeemed through the link so expiry, revocation and the cap decide.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    pendingSelfEnrollment: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock("~/lib/courses/self-enrollment.server", () => ({
  redeemSelfEnrollmentLink: vi.fn(),
  selfEnrollmentLinkIdForToken: vi.fn(),
}));
vi.mock("~/lib/courses/self-enrollment-audit.server", () => ({
  logSelfEnrollmentRedeemed: vi.fn(),
}));

import prisma from "~/lib/prisma.server";
import {
  redeemSelfEnrollmentLink,
  selfEnrollmentLinkIdForToken,
} from "~/lib/courses/self-enrollment.server";
import { logSelfEnrollmentRedeemed } from "~/lib/courses/self-enrollment-audit.server";
import {
  recentPendingSelfEnrollmentOutcome,
  redeemPendingSelfEnrollments,
  rememberPendingSelfEnrollment,
  rememberPendingSelfEnrollmentForEmail,
  rememberPendingSelfEnrollmentForSignUp,
} from "~/lib/courses/pending-self-enrollment.server";

const USER = { id: "u1", role: "STUDENT" };
const REQUEST = new Request("http://localhost/api/auth/verify-email");
const pending = vi.mocked(prisma.pendingSelfEnrollment);

function activeAccount(overrides: { emailVerified?: boolean; isActive?: boolean } = {}) {
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    emailVerified: true,
    isActive: true,
    ...overrides,
  } as never);
}

function onePending() {
  pending.findMany.mockResolvedValue([{ id: "p1", linkId: "link-1" }] as never);
}

beforeEach(() => {
  // `reset`, not `clear`: queued `mockResolvedValueOnce` answers must not leak
  // from one test into the next.
  vi.resetAllMocks();
  pending.updateMany.mockResolvedValue({ count: 1 } as never);
});

describe("rememberPendingSelfEnrollment (#1961)", () => {
  it("keeps the link (not the token) against the account, clearing any earlier verdict", async () => {
    vi.mocked(selfEnrollmentLinkIdForToken).mockResolvedValue("link-1");

    expect(await rememberPendingSelfEnrollment({ userId: "u1", token: "raw-secret" })).toBe(true);
    expect(pending.upsert).toHaveBeenCalledWith({
      where: { userId_linkId: { userId: "u1", linkId: "link-1" } },
      create: { userId: "u1", linkId: "link-1" },
      update: { resolvedAt: null, outcome: null },
    });
    expect(JSON.stringify(pending.upsert.mock.calls)).not.toContain("raw-secret");
  });

  it("remembers nothing for a token that matches no link", async () => {
    vi.mocked(selfEnrollmentLinkIdForToken).mockResolvedValue(null);

    expect(await rememberPendingSelfEnrollment({ userId: "u1", token: "nope" })).toBe(false);
    expect(pending.upsert).not.toHaveBeenCalled();
  });

  it("reports a failed write instead of throwing into the sign-up", async () => {
    vi.mocked(selfEnrollmentLinkIdForToken).mockResolvedValue("link-1");
    pending.upsert.mockRejectedValue(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await rememberPendingSelfEnrollment({ userId: "u1", token: "raw" })).toBe(false);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("rememberPendingSelfEnrollmentForSignUp (#1961)", () => {
  const SIGN_UP = { userId: "new-user", email: " New@Student.UBC.ca ", token: "raw" };

  it("remembers the join for the account this sign-up created", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "new-user" } as never);
    vi.mocked(selfEnrollmentLinkIdForToken).mockResolvedValue("link-1");

    expect(await rememberPendingSelfEnrollmentForSignUp(SIGN_UP)).toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "new@student.ubc.ca" },
      select: { id: true },
    });
    expect(pending.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { userId: "new-user", linkId: "link-1" } }),
    );
  });

  it("ignores Better Auth's stand-in for an email that already has an account", async () => {
    // The stand-in's id matches no row; the real account belongs to whoever
    // registered that email, which this sign-up has not proved to be its author.
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "existing-user" } as never);

    expect(await rememberPendingSelfEnrollmentForSignUp(SIGN_UP)).toBe(false);
    expect(pending.upsert).not.toHaveBeenCalled();
  });

  it("reports a failed lookup instead of throwing into the sign-up", async () => {
    vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await rememberPendingSelfEnrollmentForSignUp(SIGN_UP)).toBe(false);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("rememberPendingSelfEnrollmentForEmail (#1961)", () => {
  it("remembers the join for an unverified account, looked up by lowercased email", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "u1",
      emailVerified: false,
    } as never);
    vi.mocked(selfEnrollmentLinkIdForToken).mockResolvedValue("link-1");

    expect(
      await rememberPendingSelfEnrollmentForEmail({ email: " Student@UBC.ca ", token: "raw" }),
    ).toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "student@ubc.ca" },
      select: { id: true, emailVerified: true },
    });
    expect(pending.upsert).toHaveBeenCalled();
  });

  it("leaves a verified or unknown account alone", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: "u1",
      emailVerified: true,
    } as never);
    expect(await rememberPendingSelfEnrollmentForEmail({ email: "a@ubc.ca", token: "raw" })).toBe(
      false,
    );

    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    expect(await rememberPendingSelfEnrollmentForEmail({ email: "b@ubc.ca", token: "raw" })).toBe(
      false,
    );
    expect(pending.upsert).not.toHaveBeenCalled();
  });
});

describe("redeemPendingSelfEnrollments (#1961)", () => {
  it("costs one query and nothing more when nothing is pending", async () => {
    pending.findMany.mockResolvedValue([]);

    expect(await redeemPendingSelfEnrollments(USER, REQUEST)).toEqual([]);
    expect(pending.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", resolvedAt: null },
      select: { id: true, linkId: true },
      orderBy: { createdAt: "asc" },
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("never enrolls an account that is not verified, or is deactivated", async () => {
    onePending();

    activeAccount({ emailVerified: false });
    expect(await redeemPendingSelfEnrollments(USER, REQUEST)).toEqual([]);
    activeAccount({ isActive: false });
    expect(await redeemPendingSelfEnrollments(USER, REQUEST)).toEqual([]);
    expect(redeemSelfEnrollmentLink).not.toHaveBeenCalled();
  });

  it("joins through the link, records JOINED and audits the new enrollment as deferred", async () => {
    onePending();
    activeAccount();
    vi.mocked(redeemSelfEnrollmentLink).mockResolvedValue({
      status: "201",
      courseId: "c1",
      enrollmentId: "enr-1",
      linkId: "link-1",
      alreadyEnrolled: false,
    });

    expect(await redeemPendingSelfEnrollments(USER, REQUEST)).toEqual([
      { linkId: "link-1", outcome: "JOINED" },
    ]);
    expect(redeemSelfEnrollmentLink).toHaveBeenCalledWith({ linkId: "link-1", userId: "u1" });
    expect(pending.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", resolvedAt: null },
      data: { resolvedAt: expect.any(Date), outcome: "JOINED" },
    });
    expect(logSelfEnrollmentRedeemed).toHaveBeenCalledWith({
      user: USER,
      request: REQUEST,
      enrollmentId: "enr-1",
      courseId: "c1",
      linkId: "link-1",
      deferred: true,
    });
  });

  it("counts an already-enrolled answer as joined, without a second audit entry", async () => {
    onePending();
    activeAccount();
    vi.mocked(redeemSelfEnrollmentLink).mockResolvedValue({
      status: "200",
      courseId: "c1",
      enrollmentId: "enr-1",
      linkId: "link-1",
      alreadyEnrolled: true,
    });

    expect(await redeemPendingSelfEnrollments(USER, REQUEST)).toEqual([
      { linkId: "link-1", outcome: "JOINED" },
    ]);
    expect(logSelfEnrollmentRedeemed).not.toHaveBeenCalled();
  });

  it("records why a link refused (expired, revoked, full) and enrolls nobody", async () => {
    onePending();
    activeAccount();
    vi.mocked(redeemSelfEnrollmentLink).mockResolvedValue({
      status: "410",
      error: "LINK_EXPIRED",
    });

    expect(await redeemPendingSelfEnrollments(USER, REQUEST)).toEqual([
      { linkId: "link-1", outcome: "LINK_EXPIRED" },
    ]);
    expect(pending.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", resolvedAt: null },
      data: { resolvedAt: expect.any(Date), outcome: "LINK_EXPIRED" },
    });
    expect(logSelfEnrollmentRedeemed).not.toHaveBeenCalled();
  });

  it("leaves a join pending when redemption throws, and still tries the others", async () => {
    pending.findMany.mockResolvedValue([
      { id: "p1", linkId: "link-1" },
      { id: "p2", linkId: "link-2" },
    ] as never);
    activeAccount();
    vi.mocked(redeemSelfEnrollmentLink)
      .mockRejectedValueOnce(new Error("db blip"))
      .mockResolvedValueOnce({ status: "403", error: "LINK_REVOKED" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await redeemPendingSelfEnrollments(USER, REQUEST)).toEqual([
      { linkId: "link-2", outcome: "LINK_REVOKED" },
    ]);
    expect(pending.updateMany).toHaveBeenCalledTimes(1);
    expect(pending.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p2", resolvedAt: null } }),
    );
    log.mockRestore();
  });

  it("does not report a verdict another request recorded first", async () => {
    onePending();
    activeAccount();
    vi.mocked(redeemSelfEnrollmentLink).mockResolvedValue({
      status: "200",
      courseId: "c1",
      enrollmentId: "enr-1",
      linkId: "link-1",
      alreadyEnrolled: true,
    });
    pending.updateMany.mockResolvedValue({ count: 0 } as never);

    expect(await redeemPendingSelfEnrollments(USER, REQUEST)).toEqual([]);
  });

  it("swallows a failed lookup rather than failing the sign-in", async () => {
    pending.findMany.mockRejectedValue(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await redeemPendingSelfEnrollments(USER, REQUEST)).toEqual([]);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("recentPendingSelfEnrollmentOutcome (#1961)", () => {
  const ROW = (outcome: string, id = "c1", code = "PSYO 121") => ({
    outcome,
    link: { course: { id, code } },
  });

  it("looks only at verdicts from the last day, newest first", async () => {
    pending.findMany.mockResolvedValue([]);
    const before = Date.now();

    expect(await recentPendingSelfEnrollmentOutcome("u1")).toBeNull();

    const query = pending.findMany.mock.calls[0][0] as {
      where: { userId: string; resolvedAt: { gte: Date } };
    };
    expect(query.where.userId).toBe("u1");
    const windowMs = before - query.where.resolvedAt.gte.getTime();
    expect(windowMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
    expect(windowMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
    expect(pending.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { resolvedAt: "desc" },
        select: {
          outcome: true,
          link: { select: { course: { select: { id: true, code: true } } } },
        },
      }),
    );
  });

  it("reports a join with its course", async () => {
    pending.findMany.mockResolvedValue([ROW("JOINED")] as never);

    expect(await recentPendingSelfEnrollmentOutcome("u1")).toEqual({
      joined: true,
      outcome: "JOINED",
      courseId: "c1",
      courseCode: "PSYO 121",
    });
  });

  it("reports a refusal ahead of a newer join, so it is not hidden", async () => {
    pending.findMany.mockResolvedValue([
      ROW("JOINED", "c2", "DATA 301"),
      ROW("LINK_EXPIRED", "c1", "PSYO 121"),
    ] as never);

    expect(await recentPendingSelfEnrollmentOutcome("u1")).toEqual({
      joined: false,
      outcome: "LINK_EXPIRED",
      courseId: "c1",
      courseCode: "PSYO 121",
    });
  });
});
