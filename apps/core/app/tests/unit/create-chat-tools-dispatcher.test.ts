// @vitest-environment node
//
// #1659 review (ariqmuldi, PR #1666): createChatTools' mode dispatch
// (agent-tools/index.ts) is a plain if/if/else — correct today, but nothing
// in the suite exercises the *real* dispatcher: create-instructor-chat-
// tools.test.ts calls createInstructorChatTools directly, and every
// chat.rbac.test.ts-style route test mocks ~/lib/agent-tools wholesale
// (createChatTools: vi.fn().mockReturnValue({})). A plausible copy/paste
// slip on the adjacent, structurally-identical admin/instructor branches
// (e.g. `if (mode === "instructor") return createAdminChatTools(ctx);`)
// would hand an instructor the entire admin tool registry — user directory,
// bug-report triage, every admin write tool — and nothing here would catch
// it. This pins the real dispatcher's instructor branch against the real
// factory's own manifest.

import { describe, it, expect, vi } from "vitest";

vi.mock("~/lib/agent-tools/admin-context.server", () => ({
  getAccessibleCourse: vi.fn(),
  listAdminCourseEnrollments: vi.fn(),
  listAdminCourseTopics: vi.fn(),
  getAdminCourseTopic: vi.fn(),
}));

import { createChatTools } from "~/lib/agent-tools";
import { createInstructorChatTools } from "~/lib/agent-tools/create-instructor-chat-tools";
import type { ChatToolContext } from "~/lib/agent-tools/chat-mode";

const ctx: ChatToolContext = {
  user: { id: "instructor-1", role: "INSTRUCTOR" },
  effectiveCourseId: "course-1",
  effectiveCourseCode: "COSC 101",
};

describe("createChatTools — instructor dispatch (#1659 review)", () => {
  it("routes mode 'instructor' to createInstructorChatTools's exact manifest", () => {
    const dispatched = createChatTools(ctx, "instructor");
    const direct = createInstructorChatTools(ctx);

    expect(Object.keys(dispatched).slice().sort()).toEqual(Object.keys(direct).slice().sort());
    // The severe failure mode this guards against isn't just "wrong key
    // count" — it's "the whole admin registry leaked in", which a bare
    // key-count check could miss if the two manifests happened to be the
    // same size. Naming the exact 4 tools makes that failure mode loud.
    expect(Object.keys(dispatched).slice().sort()).toEqual([
      "getCourse",
      "getCourseTopic",
      "listCourseEnrollments",
      "listCourseTopics",
    ]);
  });
});
