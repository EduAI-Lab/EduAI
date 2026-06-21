// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

// buildChatVisibilityFilter takes no DB calls on the non-admin path and an empty
// filter on the admin path, so a bare prisma mock is enough to import the module.
vi.mock("~/lib/prisma.server", () => ({ default: {} }));

import { buildChatVisibilityFilter } from "~/lib/chat-history/server";

describe("buildChatVisibilityFilter — legacy listing path (#5c)", () => {
  it("ADMIN sees every chat (empty filter)", async () => {
    expect(await buildChatVisibilityFilter({ id: "a1", role: "ADMIN" })).toEqual({});
  });

  // Regression for the legacy-oversight bypass: staff roles must NOT gain
  // course-chat visibility through this path — oversight is policy-gated and
  // served only by the §5c endpoints. Every non-admin viewer is scoped to own.
  it.each(["INSTRUCTOR", "TA", "UNIT_ADMIN", "STUDENT", null] as const)(
    "role=%s is scoped to own chats only — no course-oversight branches",
    async (role) => {
      const filter = await buildChatVisibilityFilter({ id: "u1", role });
      expect(filter).toEqual({ userId: "u1" });
    },
  );
});
