// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { readBoundedChatJson, validateChatBody } from "~/lib/chat-input.server";

function streamRequest(chunks: string[], headers: Record<string, string> = {}, close = true) {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      if (close) controller.close();
    },
    cancel,
  });
  const request = new Request("http://localhost/api/chat", {
    method: "POST",
    headers,
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { request, cancel };
}

describe("readBoundedChatJson", () => {
  it("rejects an over-limit declared Content-Length before reading the body", async () => {
    const { request, cancel } = streamRequest(
      [],
      {
        "Content-Type": "application/json",
        "Content-Length": "97",
      },
      false,
    );

    await expect(readBoundedChatJson(request, 96)).resolves.toEqual({
      ok: false,
      status: 413,
      error: "Chat request body exceeds size limit",
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects a streamed body that exceeds the cap even with a lying header", async () => {
    const body = JSON.stringify({ messages: [], oversized: "x".repeat(128) });
    const { request } = streamRequest(
      [body],
      {
        "Content-Type": "application/json",
        "Content-Length": "10",
      },
      false,
    );

    await expect(readBoundedChatJson(request, 96)).resolves.toEqual({
      ok: false,
      status: 413,
      error: "Chat request body exceeds size limit",
    });
  });

  it("parses a valid body after bounded streaming", async () => {
    const { request } = streamRequest(['{"messages":[{"role":"user","content":"', "hello", '"}]}']);

    await expect(readBoundedChatJson(request, 96)).resolves.toEqual({
      ok: true,
      body: { messages: [{ role: "user", content: "hello" }] },
    });
  });
});

describe("validateChatBody", () => {
  it("rejects a single message over the per-message content limit", () => {
    expect(
      validateChatBody(
        { messages: [{ role: "user", content: "x".repeat(11) }] },
        { maxMessageChars: 10 },
      ),
    ).toEqual({
      ok: false,
      status: 422,
      error: "message content exceeds maximum length",
    });
  });

  it("rejects aggregate message content over the total limit", () => {
    expect(
      validateChatBody(
        {
          messages: [
            { role: "user", content: "x".repeat(6) },
            { role: "user", content: "y".repeat(6) },
          ],
        },
        { maxMessageChars: 10, maxTotalMessageChars: 10 },
      ),
    ).toEqual({
      ok: false,
      status: 422,
      error: "messages exceed aggregate character limit",
    });
  });

  it("rejects a message count over the configured limit", () => {
    expect(
      validateChatBody({ messages: [{ content: "a" }, { content: "b" }] }, { maxMessages: 1 }),
    ).toEqual({
      ok: false,
      status: 422,
      error: "messages exceeds maximum count",
    });
  });
});
