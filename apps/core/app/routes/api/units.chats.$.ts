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
import { getPolicy, logPolicyDenial } from "~/lib/policy.server";
import prisma from "~/lib/prisma.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export async function loader({ request, params }: LoaderFunctionArgs) {
  const department = params.department;
  if (!department) {
    return json({ error: "Department is required" }, 400);
  }

  const session = await auth.api.getSession(request);
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
      logPolicyDenial({
        policyKey: "unitAdmins.canViewUnitChats",
        userId: session.user.id,
        role,
        action: "unit.chats.view",
      });
      return json({ error: "Forbidden" }, 403);
    }
  }

  const chats = await prisma.chat.findMany({
    where: { course: { department, deletedAt: null } },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { id: true, name: true } },
      course: { select: { id: true, code: true, name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return json({
    chats: chats.map((chat) => ({
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
  });
}
