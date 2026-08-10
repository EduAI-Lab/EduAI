// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/chat-history/server", () => ({
  resolveChatReadAccess: vi.fn(),
  getChatMessages: vi.fn(),
}));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

const prismaMock = vi.hoisted(() => ({
  aIModel: { findMany: vi.fn() },
}));
vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

vi.mock("~/lib/courses/server", () => ({
  getAccessibleCourseCodes: vi.fn(),
}));

vi.mock("~/lib/user-preferences.server", () => ({
  getUserPreference: vi.fn(),
  saveUserPreference: vi.fn(),
}));

vi.mock("~/lib/chat-auto-model", () => ({
  withAutoChatModel: vi.fn(),
}));

vi.mock("~/lib/routing-model-settings.server", () => ({
  getRoutingModelSettings: vi.fn(),
}));

import { resolveChatReadAccess, getChatMessages } from "~/lib/chat-history/server";
import { auth } from "~/lib/auth/server";
import { getAccessibleCourseCodes } from "~/lib/courses/server";
import { getUserPreference, saveUserPreference } from "~/lib/user-preferences.server";
import { withAutoChatModel } from "~/lib/chat-auto-model";
import { getRoutingModelSettings } from "~/lib/routing-model-settings.server";
import {
  loadChatBaseData,
  loadChatTranscript,
  chatPreferencesAction,
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

const PREFERENCES = {
  assistDefault: false,
  lastCourseCode: null,
  motionReduced: false,
  density: "comfortable" as const,
  theme: "system" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadChatTranscript", () => {
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

  it("stringifies a non-Date updatedAt value coming back from the DB", async () => {
    vi.mocked(resolveChatReadAccess).mockResolvedValue({
      ...CHAT_ACCESS,
      chat: { ...CHAT_ACCESS.chat, updatedAt: "2026-01-02T00:00:00.000Z" as never },
    });
    vi.mocked(getChatMessages).mockResolvedValue([]);

    const result = await loadChatTranscript({ id: "owner-1", role: "STUDENT" }, "chat-1");

    expect(result!.chat.updatedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("falls back to null course fields when the chat has no course", async () => {
    vi.mocked(resolveChatReadAccess).mockResolvedValue({
      ...CHAT_ACCESS,
      chat: { ...CHAT_ACCESS.chat, courseId: null, course: null },
    });
    vi.mocked(getChatMessages).mockResolvedValue([]);

    const result = await loadChatTranscript({ id: "owner-1", role: "STUDENT" }, "chat-1");

    expect(result!.chat.courseCode).toBeNull();
    expect(result!.chat.courseName).toBeNull();
  });
});

describe("loadChatBaseData", () => {
  it("redirects anonymous callers to /auth/login", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);

    await expect(
      loadChatBaseData(new Request("http://localhost/chat").headers as never),
    ).rejects.toMatchObject({ status: 302 });
  });

  it("assembles chat models, preferences, and routing flags for a signed-in user", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(getRoutingModelSettings).mockResolvedValue({
      autoLlmEnabled: true,
      autoRulesEnabled: false,
    });
    prismaMock.aIModel.findMany.mockResolvedValue([
      {
        provider: { name: "openai" },
        modelId: "gpt-4o",
        name: "GPT-4o",
        description: "desc",
        maxTokens: 1000,
        supportsImages: true,
        supportsTools: true,
      },
    ]);
    vi.mocked(withAutoChatModel).mockReturnValue([
      { id: "openai:gpt-4o", name: "GPT-4o", description: "desc", provider: "openai" },
    ]);
    vi.mocked(getAccessibleCourseCodes).mockResolvedValue(["COSC 101"]);
    vi.mocked(getUserPreference).mockResolvedValue(PREFERENCES);

    const result = await loadChatBaseData(
      new Request("http://localhost/chat").headers as never,
    );

    expect(result.user).toEqual({ id: "u1", role: "STUDENT" });
    expect(result.routerAutoEnabled).toBe(true);
    expect(result.showRoutingModels).toBe(true);
    expect(result.chatModels).toEqual([
      { id: "openai:gpt-4o", name: "GPT-4o", description: "desc", provider: "openai" },
    ]);
    expect(result.assistDefault).toBe(false);
    expect(prismaMock.aIModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true, provider: { isActive: true } } }),
    );
    expect(getAccessibleCourseCodes).toHaveBeenCalledWith({ id: "u1", role: "STUDENT" });
    expect(getUserPreference).toHaveBeenCalledWith("u1", ["COSC 101"]);
  });

  it("disables routing models when both auto flags are off", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(getRoutingModelSettings).mockResolvedValue({
      autoLlmEnabled: false,
      autoRulesEnabled: false,
    });
    prismaMock.aIModel.findMany.mockResolvedValue([]);
    vi.mocked(withAutoChatModel).mockReturnValue([]);
    vi.mocked(getAccessibleCourseCodes).mockResolvedValue([]);
    vi.mocked(getUserPreference).mockResolvedValue(PREFERENCES);

    const result = await loadChatBaseData(
      new Request("http://localhost/chat").headers as never,
    );

    expect(result.routerAutoEnabled).toBe(false);
    expect(result.showRoutingModels).toBe(false);
  });
});

describe("chatPreferencesAction", () => {
  it("returns 401 for anonymous callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);

    const res = (await chatPreferencesAction({
      request: new Request("http://localhost/chat", {
        method: "POST",
        body: JSON.stringify({ assistDefault: true }),
      }),
    } as never)) as Response;

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(saveUserPreference).not.toHaveBeenCalled();
  });

  it("returns 400 when the body has no valid preference fields", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);

    const res = (await chatPreferencesAction({
      request: new Request("http://localhost/chat", {
        method: "POST",
        body: JSON.stringify({ unknownField: "x" }),
      }),
    } as never)) as Response;

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "No valid preference fields provided" });
    expect(saveUserPreference).not.toHaveBeenCalled();
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);

    const res = (await chatPreferencesAction({
      request: new Request("http://localhost/chat", {
        method: "POST",
        body: "not json",
        headers: { "Content-Type": "application/json" },
      }),
    } as never)) as Response;

    expect(res.status).toBe(400);
    expect(saveUserPreference).not.toHaveBeenCalled();
  });

  it("saves valid preference updates for a signed-in user", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    const savedResponse = new Response(JSON.stringify(PREFERENCES), { status: 200 });
    vi.mocked(saveUserPreference).mockResolvedValue(savedResponse as never);

    const res = await chatPreferencesAction({
      request: new Request("http://localhost/chat", {
        method: "POST",
        body: JSON.stringify({ assistDefault: true, lastCourseCode: "COSC 101" }),
      }),
    } as never);

    expect(res).toBe(savedResponse);
    expect(saveUserPreference).toHaveBeenCalledWith("u1", {
      assistDefault: true,
      lastCourseCode: "COSC 101",
    });
  });
});
