// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth/server", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("~/lib/auth/rate-limit.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth/rate-limit.server")>()),
  checkRateLimit: vi.fn(),
}));
vi.mock("~/lib/chat/attachment-extraction.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/chat/attachment-extraction.server")>()),
  extractChatAttachment: vi.fn(),
}));

import { auth } from "~/lib/auth/server";
import { checkRateLimit } from "~/lib/auth/rate-limit.server";
import {
  ChatAttachmentError,
  extractChatAttachment,
} from "~/lib/chat/attachment-extraction.server";
import { action } from "~/routes/api/chat.attachments";

function makeArgs(file?: File, method = "POST") {
  const init: RequestInit = { method };
  if (file) {
    const form = new FormData();
    form.append("file", file);
    init.body = form;
  }
  return {
    request: new Request("http://localhost/api/chat/attachments", init),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role: "STUDENT" },
  } as never);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false, retryAfter: 0 });
});

describe("POST /api/chat/attachments", () => {
  it("rejects non-POST", async () => {
    const res = await action(makeArgs(undefined, "GET"));
    expect(res.status).toBe(405);
  });

  it("returns 401 for anonymous callers", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = await action(makeArgs(new File(["x"], "a.txt")));
    expect(res.status).toBe(401);
    expect(extractChatAttachment).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when rate limited, before reading the body", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ limited: true, retryAfter: 7 });
    const res = await action(makeArgs(new File(["x"], "a.txt")));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("7");
    expect(extractChatAttachment).not.toHaveBeenCalled();
  });

  it("keys the rate limit by user", async () => {
    vi.mocked(extractChatAttachment).mockResolvedValue({
      name: "a.txt",
      contentType: "text/plain",
      text: "x",
      truncated: false,
      charCount: 1,
    });
    await action(makeArgs(new File(["x"], "a.txt")));
    expect(checkRateLimit).toHaveBeenCalledWith("chat-attachment:u1", 20, 60_000);
  });

  it("returns 400 when no file field is sent", async () => {
    const res = await action(makeArgs(undefined));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("ATTACHMENT_MISSING");
  });

  it("returns the extraction on success", async () => {
    const extraction = {
      name: "a.txt",
      contentType: "text/plain" as const,
      text: "hello",
      truncated: false,
      charCount: 5,
    };
    vi.mocked(extractChatAttachment).mockResolvedValue(extraction);
    const res = await action(makeArgs(new File(["hello"], "a.txt")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(extraction);
  });

  it.each([
    ["ATTACHMENT_TYPE_UNSUPPORTED", 400],
    ["ATTACHMENT_TOO_LARGE", 413],
    ["ATTACHMENT_EMPTY", 422],
    ["ATTACHMENT_EXTRACT_FAILED", 422],
  ] as const)("maps %s to %i with a human sentence", async (code, status) => {
    vi.mocked(extractChatAttachment).mockRejectedValue(new ChatAttachmentError(code));
    const res = await action(makeArgs(new File(["x"], "a.txt")));
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.code).toBe(code);
    expect(body.error).toMatch(/ /u);
  });

  it("maps an unexpected error to ATTACHMENT_EXTRACT_FAILED without leaking it", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(extractChatAttachment).mockRejectedValue(new Error("secret stack detail"));
    const res = await action(makeArgs(new File(["x"], "a.txt")));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("ATTACHMENT_EXTRACT_FAILED");
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
