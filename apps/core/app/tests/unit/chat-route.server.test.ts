// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/chat-history/server", () => ({
  resolveChatReadAccess: vi.fn(),
  getChatMessages: vi.fn(),
}));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: { aIModel: { findMany: vi.fn() } },
}));

vi.mock("~/lib/courses/server", () => ({
  getAccessibleCourseCodes: vi.fn(),
}));

vi.mock("~/lib/user-preferences.server", () => ({
  getUserPreference: vi.fn(),
  saveUserPreference: vi.fn(),
}));

vi.mock("~/lib/routing-model-settings.server", () => ({
  getRoutingModelSettings: vi.fn(),
}));

import { resolveChatReadAccess, getChatMessages } from "~/lib/chat-history/server";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { getAccessibleCourseCodes } from "~/lib/courses/server";
import { getUserPreference } from "~/lib/user-preferences.server";
import { getRoutingModelSettings } from "~/lib/routing-model-settings.server";
import {
  loadChatBaseData,
  loadChatBaseDataForUser,
  loadChatTranscript,
  requireChatSessionUser,
} from "~/lib/chat/chat-route.server";

const CHAT_ACCESS = {
  chat: {
    id: "chat-1",
    userId: "owner-1",
    courseId: "c1",
    systemPrompt: null,
    title: "Test chat",
    adhdAssist: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    course: { id: "c1", code: "COSC 101", name: "Intro" },
    user: { id: "owner-1", name: "Alex Patel", email: "student1@eduai.local" },
  },
  isOwner: true,
  canEdit: true,
};

const USER = { id: "user-1", role: "STUDENT", name: "Alex Patel" } as never;

const PREFERENCES = {
  assistDefault: false,
  lastCourseCode: null,
  motionReduced: false,
  density: "comfortable",
  theme: "system",
};

/**
 * Wrap a mock so it holds until `release()` is called, tracking how many of the
 * wrapped calls were in flight at once. Sequential awaits peak at 1.
 */
function makeConcurrencyTracker() {
  let inFlight = 0;
  let maxInFlight = 0;
  const releases: Array<() => void> = [];

  return {
    get maxInFlight() {
      return maxInFlight;
    },
    track<T>(value: T) {
      return () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise<T>((resolve) => {
          releases.push(() => {
            inFlight -= 1;
            resolve(value);
          });
        });
      };
    },
    /**
     * Release everything currently held, yielding between passes so a *serial*
     * implementation — which only enqueues its next release a microtask after
     * the previous one resolves — still runs to completion instead of hanging
     * the test. The concurrency assertion must therefore be made before this
     * is called, so a serial regression fails on the assertion rather than on
     * a 5s vitest timeout.
     */
    async drain() {
      for (let pass = 0; pass < 10; pass += 1) {
        while (releases.length > 0) {
          releases.shift()!();
        }
        await Promise.resolve();
        await Promise.resolve();
      }
    },
  };
}

describe("requireChatSessionUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the session user", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: USER } as never);

    await expect(
      requireChatSessionUser(new Request("http://localhost/chat/chat-1")),
    ).resolves.toBe(USER);
  });

  it("redirects to login when there is no session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);

    const thrown = await requireChatSessionUser(
      new Request("http://localhost/chat/chat-1"),
    ).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("Location")).toBe("/auth/login");
  });
});

describe("loadChatBaseDataForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRoutingModelSettings).mockResolvedValue({
      autoLlmEnabled: false,
      autoRulesEnabled: false,
    } as never);
    vi.mocked(prisma.aIModel.findMany).mockResolvedValue([] as never);
    vi.mocked(getAccessibleCourseCodes).mockResolvedValue(["COSC 101"] as never);
    vi.mocked(getUserPreference).mockResolvedValue(PREFERENCES as never);
  });

  it("issues the three independent reads concurrently", async () => {
    const tracker = makeConcurrencyTracker();
    vi.mocked(getRoutingModelSettings).mockImplementation(
      tracker.track({ autoLlmEnabled: false, autoRulesEnabled: false }) as never,
    );
    vi.mocked(prisma.aIModel.findMany).mockImplementation(tracker.track([]) as never);
    vi.mocked(getAccessibleCourseCodes).mockImplementation(
      tracker.track(["COSC 101"]) as never,
    );

    const pending = loadChatBaseDataForUser(USER);
    await Promise.resolve();

    // Asserted while all three are still held: a serial rewrite peaks at 1 and
    // fails here, rather than deadlocking on the drain below.
    expect(tracker.maxInFlight).toBe(3);

    await tracker.drain();
    await pending;
  });

  it("passes the accessible course codes to the preference read", async () => {
    const data = await loadChatBaseDataForUser(USER);

    expect(getUserPreference).toHaveBeenCalledWith("user-1", ["COSC 101"]);
    expect(data.user).toBe(USER);
    expect(data.lastCourseCode).toBeNull();
  });

  it("prepends routing models when auto routing is enabled", async () => {
    vi.mocked(getRoutingModelSettings).mockResolvedValue({
      autoLlmEnabled: true,
      autoRulesEnabled: true,
    } as never);

    const data = await loadChatBaseDataForUser(USER);

    expect(data.routerAutoEnabled).toBe(true);
    expect(data.showRoutingModels).toBe(true);
    expect(data.chatModels.map((model) => model.id)).toEqual(["auto-llm", "auto"]);
  });

  it("maps the selected model columns into ChatModelOption", async () => {
    vi.mocked(prisma.aIModel.findMany).mockResolvedValue([
      {
        modelId: "gpt-4o",
        name: "GPT-4o",
        description: "Fast multimodal",
        maxTokens: 128000,
        supportsImages: true,
        supportsTools: true,
        provider: { name: "openai" },
      },
    ] as never);

    const data = await loadChatBaseDataForUser(USER);

    expect(data.chatModels).toEqual([
      {
        id: "openai:gpt-4o",
        name: "GPT-4o",
        description: "Fast multimodal",
        provider: "openai",
        maxTokens: 128000,
        supportsImages: true,
        supportsTools: true,
      },
    ]);
  });

  it("is what loadChatBaseData composes with the session lookup", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: USER } as never);

    const data = await loadChatBaseData(new Request("http://localhost/chat"));

    expect(data.user).toBe(USER);
    expect(getAccessibleCourseCodes).toHaveBeenCalledWith(USER);
  });

  it("propagates the login redirect out of loadChatBaseData", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);

    const thrown = await loadChatBaseData(new Request("http://localhost/chat")).catch(
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("Location")).toBe("/auth/login");
  });

  it("reads nothing from the database when there is no session", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);

    await loadChatBaseData(new Request("http://localhost/chat")).catch(() => {});

    // The parallel block must stay behind the auth guard: an unauthenticated
    // caller costs zero queries.
    expect(getRoutingModelSettings).not.toHaveBeenCalled();
    expect(prisma.aIModel.findMany).not.toHaveBeenCalled();
    expect(getAccessibleCourseCodes).not.toHaveBeenCalled();
    expect(getUserPreference).not.toHaveBeenCalled();
  });

  it("resolves the session before issuing any base-data read", async () => {
    let releaseSession: ((value: unknown) => void) | undefined;
    vi.mocked(auth.api.getSession).mockReturnValue(
      new Promise((resolve) => {
        releaseSession = resolve;
      }) as never,
    );

    const pending = loadChatBaseData(new Request("http://localhost/chat"));
    await Promise.resolve();

    expect(getRoutingModelSettings).not.toHaveBeenCalled();
    expect(prisma.aIModel.findMany).not.toHaveBeenCalled();
    expect(getAccessibleCourseCodes).not.toHaveBeenCalled();

    releaseSession!({ user: USER });
    await pending;

    expect(getAccessibleCourseCodes).toHaveBeenCalledWith(USER);
  });
});

describe("loadChatTranscript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the viewer may not read the chat", async () => {
    vi.mocked(resolveChatReadAccess).mockResolvedValue(null);

    const result = await loadChatTranscript(
      { id: "other-user", role: "STUDENT" },
      "chat-1",
    );

    expect(result).toBeNull();
    expect(getChatMessages).not.toHaveBeenCalled();
  });

  it("returns a hydrated transcript for an authorized owner", async () => {
    vi.mocked(resolveChatReadAccess).mockResolvedValue(CHAT_ACCESS);
    vi.mocked(getChatMessages).mockResolvedValue([
      { messageId: "m1", role: "user", content: { id: "m1", role: "user", content: "hello" } },
    ]);

    const result = await loadChatTranscript(
      { id: "owner-1", role: "STUDENT" },
      "chat-1",
    );

    expect(result).not.toBeNull();
    expect(result!.canEdit).toBe(true);
    expect(result!.chat.id).toBe("chat-1");
    expect(result!.chat.courseCode).toBe("COSC 101");
    expect(result!.messages).toHaveLength(1);
    expect(result!.messages[0]).toMatchObject({ role: "user", content: "hello" });
    expect(getChatMessages).toHaveBeenCalledWith("chat-1");
  });

  it("restores the durable long-output cap flag through transcript hydration", async () => {
    vi.mocked(resolveChatReadAccess).mockResolvedValue(CHAT_ACCESS);
    vi.mocked(getChatMessages).mockResolvedValue([
      {
        messageId: "assistant-capped",
        role: "assistant",
        content: {
          id: "assistant-capped",
          role: "assistant",
          content: "Partial answer",
          metadata: { hitLongOutputCap: true },
        },
      },
    ]);

    const result = await loadChatTranscript(
      { id: "owner-1", role: "STUDENT" },
      "chat-1",
    );

    expect(result?.messages).toEqual([
      expect.objectContaining({
        id: "assistant-capped",
        role: "assistant",
        metadata: { hitLongOutputCap: true },
      }),
    ]);
  });

  it("marks oversight reads as non-editable", async () => {
    vi.mocked(resolveChatReadAccess).mockResolvedValue({
      ...CHAT_ACCESS,
      isOwner: false,
      canEdit: false,
    });
    vi.mocked(getChatMessages).mockResolvedValue([]);

    const result = await loadChatTranscript(
      { id: "instr-1", role: "INSTRUCTOR" },
      "chat-1",
    );

    expect(result!.canEdit).toBe(false);
  });
});
