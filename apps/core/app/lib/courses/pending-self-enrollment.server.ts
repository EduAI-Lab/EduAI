/**
 * Course joins that wait for an account to be activated (#1961).
 *
 * A signed-out visitor who opens a join link is sent to sign in. With no account
 * they register, then verify their email, and nothing in that round trip carried
 * the link, so they never joined. Now the sign-up (or a sign-in refused only
 * because the email is unverified) remembers the join against the account, and
 * activation redeems it.
 *
 * - Only the link id is stored, never the token (the hash-only rule of
 *   `self-enrollment.server`).
 * - Redemption goes through `redeemSelfEnrollmentLink`, so revocation, expiry and
 *   the cap are judged when the join happens, not when the person registered.
 *   No slot is held in between.
 * - The row keeps the verdict. Whoever triggers the redemption (often a mail
 *   scanner opening the verification link first) is not who needs the answer;
 *   the landing page reads it when the person arrives.
 * - The functions sign-up, sign-in and the verification hook call never throw:
 *   a join that could not be recorded must not cost anyone their account.
 */
import prisma from "~/lib/prisma.server";
import { logSelfEnrollmentRedeemed } from "~/lib/courses/self-enrollment-audit.server";
import {
  redeemSelfEnrollmentLink,
  selfEnrollmentLinkIdForToken,
} from "~/lib/courses/self-enrollment.server";

/** The verdict a pending join records when the person got in. */
export const PENDING_JOIN_JOINED = "JOINED";

/**
 * How far back the landing page looks for a verdict: the activation that just
 * happened, not every join this account ever settled. Verification links last
 * an hour; a day leaves room for a scanner opening one well before the person.
 */
const OUTCOME_WINDOW_MS = 24 * 60 * 60 * 1000;

type PendingJoinUser = { id: string; role?: string | null };

/** A pending join that was just redeemed or refused. */
export type ResolvedPendingJoin = { linkId: string; outcome: string };

/**
 * Remember that this account set out to join through this link. False when the
 * token matches no link (nothing to redeem later) or the write failed.
 *
 * Coming back through a link clears an earlier verdict, so the person is judged
 * against the link as it is now.
 */
export async function rememberPendingSelfEnrollment(input: {
  userId: string;
  token: string;
}): Promise<boolean> {
  try {
    const linkId = await selfEnrollmentLinkIdForToken(input.token);
    if (!linkId) return false;
    await prisma.pendingSelfEnrollment.upsert({
      where: { userId_linkId: { userId: input.userId, linkId } },
      create: { userId: input.userId, linkId },
      update: { resolvedAt: null, outcome: null },
    });
    return true;
  } catch (error) {
    console.error("[pending-self-enrollment] could not remember a join", {
      userId: input.userId,
      error,
    });
    return false;
  }
}

/**
 * The same, for a sign-up through a join link. Only a sign-up that created this
 * account counts: Better Auth answers one for an email that already has an
 * account with a stand-in user whose id matches no row (so the form cannot probe
 * which emails exist), and whoever typed that address has not shown they own the
 * account. Signing in does check the password, and remembers the join there.
 */
export async function rememberPendingSelfEnrollmentForSignUp(input: {
  userId: string;
  email: string;
  token: string;
}): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      // Better Auth stores emails lowercased.
      where: { email: input.email.trim().toLowerCase() },
      select: { id: true },
    });
    if (user?.id !== input.userId) return false;
    return await rememberPendingSelfEnrollment({ userId: input.userId, token: input.token });
  } catch (error) {
    console.error("[pending-self-enrollment] could not remember a join at sign-up", { error });
    return false;
  }
}

/**
 * The same, for a sign-in Better Auth refused only because the email is not yet
 * verified. Better Auth checks the password before it answers
 * `EMAIL_NOT_VERIFIED`, so reaching this means the caller owns the account. A
 * verified account is left alone: it can sign in and press Join itself.
 */
export async function rememberPendingSelfEnrollmentForEmail(input: {
  email: string;
  token: string;
}): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      // Better Auth stores emails lowercased.
      where: { email: input.email.trim().toLowerCase() },
      select: { id: true, emailVerified: true },
    });
    if (!user || user.emailVerified) return false;
    return await rememberPendingSelfEnrollment({ userId: user.id, token: input.token });
  } catch (error) {
    console.error("[pending-self-enrollment] could not remember a join by email", { error });
    return false;
  }
}

async function attemptRedemption(linkId: string, userId: string) {
  try {
    return await redeemSelfEnrollmentLink({ linkId, userId });
  } catch (error) {
    // Left pending: the next sign-in or the landing page tries again.
    console.error("[pending-self-enrollment] redemption failed; will retry", { linkId, error });
    return null;
  }
}

async function redeemOne(
  row: { id: string; linkId: string },
  user: PendingJoinUser,
  request: Request,
): Promise<ResolvedPendingJoin | null> {
  const result = await attemptRedemption(row.linkId, user.id);
  if (!result) return null;

  let outcome: string;
  if (result.status === "201") {
    outcome = PENDING_JOIN_JOINED;
    logSelfEnrollmentRedeemed({
      user,
      request,
      enrollmentId: result.enrollmentId,
      courseId: result.courseId,
      linkId: result.linkId,
      deferred: true,
    });
  } else if (result.status === "200") {
    // Already in the course: nothing was written, so nothing to audit.
    outcome = PENDING_JOIN_JOINED;
  } else {
    outcome = result.error;
  }

  // A successful redemption must replace a racing refusal (for example when
  // the other request sees the last slot claimed before enrollment commits).
  // Refusals only settle pending rows and can never replace JOINED.
  const { count } = await prisma.pendingSelfEnrollment.updateMany({
    where: {
      id: row.id,
      ...(outcome === PENDING_JOIN_JOINED
        ? { OR: [{ resolvedAt: null }, { outcome: { not: PENDING_JOIN_JOINED } }] }
        : { resolvedAt: null }),
    },
    data: { resolvedAt: new Date(), outcome },
  });
  return count > 0 ? { linkId: row.linkId, outcome } : null;
}

/**
 * Redeem every join this account is still waiting on: when the email is verified,
 * on each sign-in (usually one indexed query that finds nothing), and on the
 * landing page. Only a verified, active account is enrolled.
 */
export async function redeemPendingSelfEnrollments(
  user: PendingJoinUser,
  request: Request,
): Promise<ResolvedPendingJoin[]> {
  try {
    const pending = await prisma.pendingSelfEnrollment.findMany({
      where: { userId: user.id, resolvedAt: null },
      select: { id: true, linkId: true },
      orderBy: { createdAt: "asc" },
    });
    if (pending.length === 0) return [];

    const account = await prisma.user.findUnique({
      where: { id: user.id },
      select: { emailVerified: true, isActive: true },
    });
    if (!account?.emailVerified || !account.isActive) return [];

    const resolved: ResolvedPendingJoin[] = [];
    for (const row of pending) {
      const outcome = await redeemOne(row, user, request);
      if (outcome) resolved.push(outcome);
    }
    return resolved;
  } catch (error) {
    console.error("[pending-self-enrollment] could not redeem pending joins", {
      userId: user.id,
      error,
    });
    return [];
  }
}

/**
 * The verdict the landing page reports: from this account's recent joins, a
 * refusal if there is one (the one thing the person can act on, by asking for a
 * new link; a course they did join is on their dashboard), else the latest join.
 * Refusals for a course with a recent successful join no longer need action.
 */
export async function recentPendingSelfEnrollmentOutcome(userId: string) {
  const rows = await prisma.pendingSelfEnrollment.findMany({
    where: { userId, resolvedAt: { gte: new Date(Date.now() - OUTCOME_WINDOW_MS) } },
    orderBy: { resolvedAt: "desc" },
    select: {
      outcome: true,
      link: { select: { course: { select: { id: true, code: true } } } },
    },
  });
  const joinedCourses = new Set(
    rows.filter((row) => row.outcome === PENDING_JOIN_JOINED).map((row) => row.link.course.id),
  );
  const shown =
    rows.find(
      (row) => row.outcome !== PENDING_JOIN_JOINED && !joinedCourses.has(row.link.course.id),
    ) ?? rows.find((row) => row.outcome === PENDING_JOIN_JOINED);
  if (!shown?.outcome) return null;
  return {
    joined: shown.outcome === PENDING_JOIN_JOINED,
    outcome: shown.outcome,
    courseId: shown.link.course.id,
    courseCode: shown.link.course.code,
  };
}
