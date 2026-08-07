/**
 * GET /api/units/:department/chats — unit-wide chat aggregate for UNIT_ADMIN (§5c).
 *
 * Lists chats across every course whose `department` matches `:department`,
 * scoped to a department in the caller's `authorizedUnits`. Gated by
 * `unitAdmins.canViewUnitChats` (off by default). ADMIN is always allowed.
 *
 * Returns chat metadata only (id, owner id + name, course id/code/name, title,
 * timestamps) — never message bodies. Chats in courses outside the unit never
 * appear.
 */
import type { LoaderFunctionArgs } from "react-router";

import { auth } from "~/lib/auth/server";
import { getAuthorizedUnits } from "~/lib/auth/course-access.server";
import { jsonResponse as json } from "~/lib/api/json-response.server";
import { getPolicy, denyByPolicy } from "~/lib/policy.server";
import prisma from "~/lib/prisma.server";
import { parseCursorParams } from "~/lib/cursor-list.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const department = params.department;
  if (!department) {
    return json({ error: "Course code is required" }, 400);
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const role = session.user.role;

  // ADMIN is always allowed. Otherwise the caller must be a UNIT_ADMIN with the
  // department in their authorized units AND the grant flag on.
  if (role !== "ADMIN") {
    if (role !== "UNIT_ADMIN") {
      return json({ error: "Forbidden" }, 403);
    }
    const units = await getAuthorizedUnits(session.user);
    if (!units.includes(department)) {
      return json({ error: "Forbidden" }, 403);
    }
    if (!(await getPolicy("unitAdmins.canViewUnitChats"))) {
      return denyByPolicy({
        request,
        policyKey: "unitAdmins.canViewUnitChats",
        user: session.user,
        action: "unit.chats.view",
      });
    }
  }

  // Limit to chats owned by an active STUDENT of the chat's OWN course — the same
  // owner-role filter the per-course endpoint applies. Without this, staff
  // (instructor/TA/unit-admin) chats tagged to a department course would leak
  // into the unit aggregate, contradicting the "student chats" contract above.
  // Sibling relations (chat.user vs chat.course) can't be correlated in a single
  // Prisma `where`, so the base chat query is fetched in bounded batches
  // (cursor-keyset on the raw, unfiltered rows) and each batch's owner-role
  // check is resolved against ONLY that batch's (courseId, userId) pairs — not
  // the whole department's roster, so this stays bounded by `limit`/batch
  // regardless of department size (#1042 review: an earlier version of this
  // fix resolved the active-student set for the whole department up front,
  // which just moved the unbounded-scan problem from chat volume to
  // enrollment volume). Capped at MAX_BATCHES so a department with a low
  // student-chat ratio still can't make one request scan every chat in the unit.
  const { cursor, limit } = parseCursorParams(new URL(request.url).searchParams);
  const MAX_BATCHES = 4;

  const page: {
    id: string;
    title: string | null;
    createdAt: Date;
    updatedAt: Date;
    user: { id: string; name: string | null };
    course: { id: string; code: string; name: string } | null;
  }[] = [];
  let rawCursor = cursor;
  let exhausted = false;

  for (let batch = 0; batch < MAX_BATCHES && page.length < limit && !exhausted; batch++) {
    // `take: limit + 1` lookahead so a final raw batch of exactly `limit` rows
    // marks the stream exhausted instead of handing back a nextCursor that
    // yields an empty page on the next click.
    const fetched = await prisma.chat.findMany({
      where: { course: { department, deletedAt: null } },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, name: true } },
        course: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(rawCursor ? { cursor: { id: rawCursor }, skip: 1 } : {}),
    });

    if (fetched.length === 0) {
      exhausted = true;
      break;
    }
    const hasMoreRaw = fetched.length > limit;
    const rows = hasMoreRaw ? fetched.slice(0, limit) : fetched;
    rawCursor = rows[rows.length - 1]!.id;
    if (!hasMoreRaw) exhausted = true;

    const pairs = rows
      .filter((chat) => chat.course)
      .map((chat) => ({ courseId: chat.course!.id, userId: chat.user.id }));
    const activeStudentEnrollments = pairs.length
      ? await prisma.enrollment.findMany({
          where: { role: "STUDENT", isActive: true, OR: pairs },
          select: { courseId: true, userId: true },
        })
      : [];
    const activeStudent = new Set(
      activeStudentEnrollments.map((e) => `${e.courseId}:${e.userId}`),
    );

    for (const chat of rows) {
      if (chat.course && activeStudent.has(`${chat.course.id}:${chat.user.id}`)) {
        page.push(chat);
      }
    }
  }

  const overflow = page.length > limit;
  const trimmedPage = overflow ? page.slice(0, limit) : page;
  // When a single batch's filtered rows overflow `limit`, the trimmed-off rows
  // were already fetched and matched but never returned — resuming from the
  // batch's raw cursor would skip them forever. Resume from the last row we
  // actually returned instead; chat.id is the same field the raw query cursors
  // on, so it's a valid resume point either way. Only safe to fall back to the
  // batch's raw cursor (skipping rows client never saw, all correctly filtered
  // out) when there was no overflow.
  const nextCursor = overflow
    ? trimmedPage[trimmedPage.length - 1]!.id
    : exhausted
      ? null
      : rawCursor;

  return json({
    chats: trimmedPage.map((chat) => ({
      id: chat.id,
      title: chat.title,
      ownerId: chat.user.id,
      ownerName: chat.user.name,
      courseId: chat.course?.id ?? null,
      courseCode: chat.course?.code ?? null,
      courseName: chat.course?.name ?? null,
      createdAt: chat.createdAt.toISOString(),
      updatedAt: chat.updatedAt.toISOString(),
    })),
    nextCursor,
  });
}
