// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/ai/active-chat-cancellations.server", () => ({
  cancelActiveChat: vi.fn(),
  isValidActiveChatRequestId: vi.fn(),
}));

import { auth } from "~/lib/auth/server";
import {
  cancelActiveChat,
  isValidActiveChatRequestId,
} from "~/lib/ai/active-chat-cancellations.server";
import { action } from "~/routes/api/chat.cancel";

const requestId = "9f1ac5c9-2abf-4b1e-b2f9-dbc1697e0aac";

function makeArgs(body?: { requestId?: string }, method = "POST") {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }

  return {
    request: new Request("http://localhost/api/chat/cancel", init),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role: "STUDENT" },
  } as never);
  vi.mocked(isValidActiveChatRequestId).mockReturnValue(true);
});

describe("POST /api/chat/cancel", () => {
  it("returns 401 for anonymous callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);

    const res = await action(makeArgs({ requestId }));

    expect(res.status).toBe(401);
    expect(cancelActiveChat).not.toHaveBeenCalled();
  });

  it("rejects malformed request ids", async () => {
    vi.mocked(isValidActiveChatRequestId).mockReturnValue(false);

    const res = await action(makeArgs({ requestId: "not-a-uuid" }));

    expect(res.status).toBe(400);
    expect(cancelActiveChat).not.toHaveBeenCalled();
  });

  it("cancels the authenticated caller's active request id", async () => {
    vi.mocked(cancelActiveChat).mockReturnValue(true);

    const res = await action(makeArgs({ requestId }));

    expect(res.status).toBe(204);
    expect(cancelActiveChat).toHaveBeenCalledWith(requestId);
  });
});
