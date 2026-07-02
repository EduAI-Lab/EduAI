// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    chat: { findFirst: vi.fn() },
    assistiveEvent: { create: vi.fn() },
  },
}));

import { action } from "~/routes/api/assistive-events";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";

// Matches zod's `.cuid()` so chatId reaches the ownership check rather than
// failing schema validation.
const VALID_CUID = "cjld2cjxh0000qzrmn831i7rn";

function makeArgs(
  method = "POST",
  body?: unknown,
  opts?: { raw?: string },
) {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (opts?.raw !== undefined) init.body = opts.raw;
  else if (body !== undefined) init.body = JSON.stringify(body);
  return {
    request: new Request("http://localhost/api/assistive-events", init),
    params: {},
    context: {} as never,
  } as any;
}

function mockUser(id = "u1") {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id } } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/assistive-events (#521)", () => {
  it("returns 405 for non-POST methods", async () => {
    const res = await action(makeArgs("GET"));
    expect(res.status).toBe(405);
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await action(makeArgs("POST", { eventType: "task_initiation" }));
    expect(res.status).toBe(401);
    expect(prisma.assistiveEvent.create).not.toHaveBeenCalled();
  });

  it("returns 422 on invalid JSON", async () => {
    mockUser();
    const res = await action(makeArgs("POST", undefined, { raw: "{not json" }));
    expect(res.status).toBe(422);
    expect(prisma.assistiveEvent.create).not.toHaveBeenCalled();
  });

  it("returns 422 when the schema rejects the payload", async () => {
    mockUser();
    // eventType is required by the schema.
    const res = await action(makeArgs("POST", { adhdAssist: true }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("VALIDATION_ERROR");
    expect(prisma.assistiveEvent.create).not.toHaveBeenCalled();
  });

  it("returns 422 for an event type outside the client allowlist", async () => {
    mockUser();
    // Valid string, but server-only — clients may not write response_compliance.
    const res = await action(makeArgs("POST", { eventType: "response_compliance" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.fields.eventType).toContain("task_initiation");
    expect(prisma.assistiveEvent.create).not.toHaveBeenCalled();
  });

  it("returns 404 when chatId is not owned by the caller", async () => {
    mockUser("u1");
    vi.mocked(prisma.chat.findFirst).mockResolvedValue(null);
    const res = await action(
      makeArgs("POST", { eventType: "session_completion", chatId: VALID_CUID }),
    );
    expect(res.status).toBe(404);
    expect(prisma.chat.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: VALID_CUID, userId: "u1" } }),
    );
    expect(prisma.assistiveEvent.create).not.toHaveBeenCalled();
  });

  it("records a chat-scoped event, defaulting adhdAssist to the chat flag (201)", async () => {
    mockUser("u1");
    vi.mocked(prisma.chat.findFirst).mockResolvedValue({
      id: VALID_CUID,
      adhdAssist: true,
    } as never);

    const res = await action(
      makeArgs("POST", {
        eventType: "task_initiation",
        chatId: VALID_CUID,
        metrics: { durationMs: 1500.6, success: true, secret: "drop" },
      }),
    );

    expect(res.status).toBe(201);
    expect(prisma.assistiveEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "u1",
          chatId: VALID_CUID,
          adhdAssist: true,
          eventType: "task_initiation",
          // metrics are sanitized: rounded duration, unknown keys dropped.
          metricsJson: { durationMs: 1501, success: true },
        }),
      }),
    );
  });

  it("records a session-less event with adhdAssist defaulting to false (201)", async () => {
    mockUser("u1");
    const res = await action(makeArgs("POST", { eventType: "re_orientation" }));

    expect(res.status).toBe(201);
    expect(prisma.chat.findFirst).not.toHaveBeenCalled();
    expect(prisma.assistiveEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "u1",
          chatId: null,
          adhdAssist: false,
          eventType: "re_orientation",
        }),
      }),
    );
  });
});
