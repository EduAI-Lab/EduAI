// @vitest-environment node
/**
 * #1959: DELETE /api/users/:id against the real test database for a user with
 * history. Their AI interactions, questions and Canvas roster syncs used to hold
 * RESTRICT foreign keys, so the delete failed with CANNOT_DELETE_USER_WITH_DATA.
 * The user's own history must go with them; course-owned rows must survive with
 * the reference nulled.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { handleUsersApiRequest } from "~/lib/api/users-api.server";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";

const PASSWORD = "Str0ng!Delete-Contract-Password";
const cleanupUserIds: string[] = [];
const cleanupCourseIds: string[] = [];

function cookieHeaderFrom(response: Response): string {
  const setCookies =
    response.headers.getSetCookie instanceof Function
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""];
  return setCookies
    .map((cookie) => cookie.split(";")[0])
    .filter(Boolean)
    .join("; ");
}

async function signInAsNewAdmin(): Promise<string> {
  const email = `user-delete-admin-${randomUUID()}@ubc.ca`;
  const signUp = (await auth.api.signUpEmail({
    body: { email, name: "User-delete admin", password: PASSWORD },
    asResponse: true,
  })) as Response;
  expect(signUp.status).toBe(200);

  const admin = await prisma.user.update({
    where: { email },
    data: { role: "ADMIN", emailVerified: true },
  });
  cleanupUserIds.push(admin.id);

  const signIn = await auth.handler(
    new Request("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
  return cookieHeaderFrom(signIn);
}

afterAll(async () => {
  await prisma.course.deleteMany({ where: { id: { in: cleanupCourseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } });
  await prisma.$disconnect();
});

describe("DELETE /api/users/:id for a user with history (#1959)", () => {
  it("deletes the user, cascades their AI interactions, and keeps course-owned rows", async () => {
    const cookie = await signInAsNewAdmin();
    const suffix = randomUUID().slice(0, 8);

    const course = await prisma.course.create({
      data: {
        code: `DEL ${suffix}`,
        name: "User-delete contract course",
        section: "001",
        term: "W1",
        year: 2026,
        startDate: new Date("2026-09-01T12:00:00Z"),
      },
    });
    cleanupCourseIds.push(course.id);
    const topic = await prisma.courseTopic.create({
      data: { courseId: course.id, name: "Heaps" },
    });

    const target = await prisma.user.create({
      data: { name: "Target", email: `user-delete-target-${suffix}@ubc.ca`, role: "INSTRUCTOR" },
    });
    cleanupUserIds.push(target.id);
    await prisma.aIInteraction.create({
      data: { userId: target.id, courseId: course.id, query: "q", response: "r", modelUsed: "m" },
    });
    const question = await prisma.question.create({
      data: {
        courseId: course.id,
        topicId: topic.id,
        createdBy: target.id,
        content: "What is a heap?",
        type: "SA",
      },
    });
    const rosterRow = await prisma.canvasRosterMember.create({
      data: {
        courseId: course.id,
        canvasUserId: `canvas-${suffix}`,
        role: "STUDENT",
        syncedByUserId: target.id,
        lastSeenAt: new Date(),
      },
    });

    const response = await handleUsersApiRequest(
      new Request(`http://localhost/api/users/${target.id}`, {
        method: "DELETE",
        headers: { cookie },
      }),
    );

    expect(response.status).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: target.id } })).toBeNull();
    expect(await prisma.aIInteraction.count({ where: { userId: target.id } })).toBe(0);
    await expect(
      prisma.question.findUnique({ where: { id: question.id }, select: { createdBy: true } }),
    ).resolves.toEqual({ createdBy: null });
    await expect(
      prisma.canvasRosterMember.findUnique({
        where: { id: rosterRow.id },
        select: { syncedByUserId: true },
      }),
    ).resolves.toEqual({ syncedByUserId: null });
  });
});
