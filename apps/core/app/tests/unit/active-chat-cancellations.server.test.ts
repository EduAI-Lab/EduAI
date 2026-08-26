import { describe, expect, it, vi } from "vitest";
import {
  cancelActiveChat,
  isValidActiveChatRequestId,
  registerActiveChatCancellation,
} from "~/lib/ai/active-chat-cancellations.server";

const requestId = "9f1ac5c9-2abf-4b1e-b2f9-dbc1697e0aac";

describe("active chat cancellations", () => {
  it("cancels an active request exactly once", () => {
    const cancel = vi.fn();
    registerActiveChatCancellation(requestId, cancel);

    expect(cancelActiveChat(requestId)).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancelActiveChat(requestId)).toBe(false);
  });

  it("does not let an earlier stream unregister a replacement", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = registerActiveChatCancellation(requestId, first);
    registerActiveChatCancellation(requestId, second);

    unregisterFirst();
    cancelActiveChat(requestId);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("accepts only UUID v4 request ids", () => {
    expect(isValidActiveChatRequestId(requestId)).toBe(true);
    expect(isValidActiveChatRequestId("not-a-request-id")).toBe(false);
    expect(isValidActiveChatRequestId("9f1ac5c9-2abf-3b1e-b2f9-dbc1697e0aac")).toBe(false);
  });
});
