// @vitest-environment node

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { handleUsersApiRequest } from "~/lib/api/users-api.server";
import { auth } from "~/lib/auth/server";

const getSession = vi.mocked(auth.api.getSession);

let adminId: string;
const createdUserIds: string[] = [];

beforeAll(async () => {
  const admin = await prisma.user.create({
    data: {
      email: `users-idem-admin-${randomUUID().slice(0, 8)}@test.local`,
      name: "Idem Admin",
      role: "ADMIN",
      emailVerified: true,
    },
  });
  adminId = admin.id;
});

afterAll(async () => {
  await prisma.idempotencyRecord.deleteMany({
    where: { route: "POST /api/users" },
  });
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.user.delete({ where: { id: adminId } });
});

beforeEach(() => {
  getSession.mockResolvedValue({
    user: { id: adminId, role: "ADMIN", name: "Idem Admin", email: "admin@test.local" },
  } as never);
});

function postUser(body: Record<string, unknown>, idempotencyKey: string) {
  return handleUsersApiRequest(
    new Request("http://localhost/api/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/users — centralized idempotency (#828)", () => {
  it("replays the same response on retry without creating a duplicate user", async () => {
    const key = `idem-${randomUUID()}`;
    const email = `idem-user-${randomUUID().slice(0, 8)}@test.local`;
    const payload = { email, name: "Idem User", role: "STUDENT" as const };

    const first = await postUser(payload, key);
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    createdUserIds.push(firstBody.id);

    const second = await postUser(payload, key);
    expect(second.status).toBe(201);
    const secondBody = await second.json();
    expect(secondBody).toEqual(firstBody);

    const count = await prisma.user.count({ where: { email } });
    expect(count).toBe(1);
  });

  it("returns IDEMPOTENCY_KEY_MISMATCH when the same key is reused with a different body", async () => {
    const key = `idem-mismatch-${randomUUID()}`;
    const email = `idem-mismatch-${randomUUID().slice(0, 8)}@test.local`;

    const first = await postUser({ email, name: "Al", role: "STUDENT" }, key);
    expect(first.status).toBe(201);
    createdUserIds.push((await first.clone().json()).id);

    const second = await postUser(
      { email: `other-${email}`, name: "Bo", role: "STUDENT" },
      key,
    );
    expect(second.status).toBe(422);
    expect(await second.json()).toEqual({ error: "IDEMPOTENCY_KEY_MISMATCH" });
  });

  it("returns JSON error envelope on validation failure", async () => {
    const res = await postUser({}, `idem-bad-${randomUUID()}`);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("VALIDATION_ERROR");
    expect(body.fields).toBeDefined();
  });
});
