import { describe, expect, it, vi } from "vitest";
import {
  cancelActiveChat,
  isValidActiveChatRequestId,
  registerActiveChatCancellation,
} from "~/lib/ai/active-chat-cancellations.server";

const requestId = "9f1ac5c9-2abf-4b1e-b2f9-dbc1697e0aac";
const replacementRequestId = "4d0c8f45-7a5f-4f12-9a73-2f719ea4cc93";
const pendingRequestId = "0f5d2c9e-8b7a-4c6d-a1e2-3f4b5c6d7e8f";

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
    const unregisterFirst = registerActiveChatCancellation(replacementRequestId, first);
    registerActiveChatCancellation(replacementRequestId, second);

    unregisterFirst();
    cancelActiveChat(replacementRequestId);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("carries a cancellation request that arrives before registration", () => {
    const cancel = vi.fn();

    expect(cancelActiveChat(pendingRequestId)).toBe(false);
    registerActiveChatCancellation(pendingRequestId, cancel);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancelActiveChat(pendingRequestId)).toBe(false);
  });

  it("accepts only UUID v4 request ids", () => {
    expect(isValidActiveChatRequestId(requestId)).toBe(true);
    expect(isValidActiveChatRequestId("not-a-request-id")).toBe(false);
    expect(isValidActiveChatRequestId("9f1ac5c9-2abf-3b1e-b2f9-dbc1697e0aac")).toBe(false);
  });
});
