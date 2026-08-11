import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import prisma from "~/lib/prisma.server";
import { auth } from "~/lib/auth/server";

function cookieHeaderFrom(response: Response): string {
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  return setCookies.map((cookie) => cookie.split(";")[0]).filter(Boolean).join("; ");
}

describe("Better Auth API-key Prisma contract", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates, lists, and revokes API keys for an authenticated admin", async () => {
    const email = `api-key-contract-${randomUUID()}@ubc.ca`;
    const signUp = (await auth.api.signUpEmail({
      body: { email, name: "API-key contract admin", password: "Str0ng!Contract-Password" },
      asResponse: true,
    })) as Response;
    expect(signUp.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    const cookie = cookieHeaderFrom(signUp);

    const create = await auth.handler(
      new Request("http://localhost/api/auth/api-key/create", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "contract-test", expiresIn: 86_400 }),
      }),
    );
    expect(create.status).toBe(200);
    const created = (await create.json()) as {
      id: string;
      key: string;
      referenceId: string;
      configId: string;
    };
    expect(created).toMatchObject({ referenceId: user.id, configId: "default" });
    expect(created.key).toEqual(expect.any(String));

    const list = await auth.handler(
      new Request("http://localhost/api/auth/api-key/list", {
        headers: { cookie },
      }),
    );

    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      apiKeys: [{ id: created.id, referenceId: user.id }],
      total: 1,
    });

    const revoke = await auth.handler(
      new Request("http://localhost/api/auth/api-key/delete", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ keyId: created.id }),
      }),
    );
    expect(revoke.status).toBe(200);
    await expect(revoke.json()).resolves.toEqual({ success: true });

    const listAfterRevoke = await auth.handler(
      new Request("http://localhost/api/auth/api-key/list", { headers: { cookie } }),
    );
    expect(listAfterRevoke.status).toBe(200);
    await expect(listAfterRevoke.json()).resolves.toMatchObject({ apiKeys: [], total: 0 });

    await prisma.user.delete({ where: { id: user.id } });
  });
});
