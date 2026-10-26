import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import type { NavShellModel } from "@eduai/ui";
import {
  isCourseChatPath,
  useCourseChatNavModel,
  type CourseChatNavOptions,
} from "~/components/layout/course-chat-nav-model";
import { PolicyProvider } from "~/components/policy/policy-gate";
import type { User } from "~/lib/auth/types";

const STUDENT = {
  id: "user-1",
  name: "Test Student",
  email: "student@eduai.test",
  role: "STUDENT",
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} as User;

const HISTORY: CourseChatNavOptions["history"] = {
  chats: [],
  isLoading: false,
  error: null,
  activeChatId: null,
  onSelect: vi.fn(),
  onNewChat: vi.fn(),
  onRefresh: vi.fn().mockResolvedValue(undefined),
};

let courses: { id: string; code: string; name: string }[] = [];

beforeEach(() => {
  courses = [{ id: "c1", code: "BIOL 116", name: "Intro Biology" }];
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: courses }) }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Builds the model inside a data router whose "root" route carries `rootData`. */
function buildModel(
  options: CourseChatNavOptions,
  {
    user = STUDENT,
    rootData = null,
  }: { user?: User; rootData?: { canUseCourseAssistant?: boolean } | null } = {},
): NavShellModel {
  let model: NavShellModel | null = null;
  function Harness() {
    model = useCourseChatNavModel(user, vi.fn(), options);
    return null;
  }
  const router = createMemoryRouter(
    [
      {
        id: "root",
        path: "*",
        loader: () => rootData,
        element: (
          <PolicyProvider policies={{}}>
            <Harness />
          </PolicyProvider>
        ),
      },
    ],
    { initialEntries: ["/chat"], hydrationData: { loaderData: { root: rootData } } },
  );
  render(<RouterProvider router={router} />);
  if (!model) throw new Error("model not built");
  return model;
}

function entryKeys(model: NavShellModel): string[] {
  return model.entries.map((entry) =>
    entry.kind === "link" ? entry.link.key : entry.kind === "tray" ? entry.tray : entry.key,
  );
}

describe("isCourseChatPath", () => {
  it.each([
    ["/chat", true],
    ["/chat/", true],
    ["/chat/abc123", true],
    ["/instructor/chat", true],
    ["/instructor/chat/", true],
    ["/chats", false],
    ["/units/CS/chats", false],
    ["/admin/chat", false],
    ["/dashboard", false],
  ])("%s → %s", (pathname, expected) => {
    expect(isCourseChatPath(pathname)).toBe(expected);
  });
});

describe("useCourseChatNavModel", () => {
  it("gives a student New chat, History, Courses and Help", () => {
    expect(entryKeys(buildModel({ history: HISTORY }))).toEqual([
      "new-chat",
      "history",
      "courses",
      "help",
    ]);
  });

  it("leaves History out when the page has no history to show", () => {
    expect(entryKeys(buildModel({}))).toEqual(["new-chat", "courses", "help"]);
  });

  it("adds Course Assistant after Courses when the root loader allows it", () => {
    const model = buildModel({}, { rootData: { canUseCourseAssistant: true } });
    expect(entryKeys(model)).toEqual(["new-chat", "courses", "instructor-chat", "help"]);
    const assistant = model.entries.find(
      (entry) => entry.kind === "link" && entry.link.key === "instructor-chat",
    );
    expect(assistant?.kind === "link" && assistant.link.href).toBe("/instructor/chat");
  });

  it("marks Course Chat as the current app and has no All courses page", () => {
    const model = buildModel({});
    expect(model.currentAppId).toBe("course-chat");
    expect(model.coursesHref).toBeUndefined();
  });

  it("links each course in the Courses tray to chat about it", async () => {
    const model = buildModel({});
    await expect(model.loadCourses?.()).resolves.toEqual([
      expect.objectContaining({ id: "c1", code: "BIOL 116", href: "/chat?courseId=c1" }),
    ]);
  });

  it("loads an empty Courses tray for a user with no courses", async () => {
    courses = [];
    const model = buildModel({});
    await expect(model.loadCourses?.()).resolves.toEqual([]);
  });

  it("hands New chat to the page when it handles it", async () => {
    const onNewChat = vi.fn();
    const model = buildModel({ onNewChat });
    const newChat = model.entries.find(
      (entry) => entry.kind === "link" && entry.link.key === "new-chat",
    );
    const preventDefault = vi.fn();
    if (newChat?.kind !== "link") throw new Error("no New chat link");
    expect(newChat.link.href).toBe("/chat");
    newChat.link.onClick?.({ preventDefault } as never);
    await waitFor(() => expect(onNewChat).toHaveBeenCalledTimes(1));
    expect(preventDefault).toHaveBeenCalled();
  });
});
