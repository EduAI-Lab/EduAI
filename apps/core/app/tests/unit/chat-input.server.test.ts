// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { createReadableStreamFromReadable } from "@react-router/node";

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
  it("returns a readable 413 through a real HTTP request boundary", async () => {
    const server = createServer(async (incoming, outgoing) => {
      const request = new Request("http://localhost/api/chat", {
        method: incoming.method,
        headers: incoming.headers as Record<string, string>,
        body: createReadableStreamFromReadable(incoming),
        duplex: "half",
      } as RequestInit & { duplex: "half" });
      const result = await readBoundedChatJson(request, 96);
      outgoing.statusCode = result.ok ? 200 : result.status;
      outgoing.setHeader("Content-Type", "application/json");
      outgoing.end(JSON.stringify(result.ok ? result.body : { error: result.error }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("test server did not bind to a TCP port");
    }

    try {
      const body = JSON.stringify({ messages: [], oversized: "x".repeat(128) });
      const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(body)),
        },
        body,
      });

      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({
        error: "Chat request body exceeds size limit",
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("returns 413 to a fetch that is still uploading a declared oversized body", async () => {
    const server = createServer(async (incoming, outgoing) => {
      const request = new Request("http://localhost/api/chat", {
        method: incoming.method,
        headers: incoming.headers as Record<string, string>,
        body: createReadableStreamFromReadable(incoming),
        duplex: "half",
      } as RequestInit & { duplex: "half" });
      const result = await readBoundedChatJson(request, 96);
      outgoing.statusCode = result.ok ? 200 : result.status;
      outgoing.setHeader("Content-Type", "application/json");
      outgoing.end(JSON.stringify(result.ok ? result.body : { error: result.error }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("test server did not bind to a TCP port");
    }

    let cancelled = false;
    const upload = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"messages":['));
        setTimeout(() => {
          if (cancelled) return;
          controller.enqueue(new TextEncoder().encode('],"oversized":"'));
          controller.enqueue(new TextEncoder().encode("x".repeat(1024)));
          controller.enqueue(new TextEncoder().encode('"}'));
          controller.close();
        }, 100);
      },
      cancel() {
        cancelled = true;
      },
    });

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "2048",
        },
        body: upload,
        duplex: "half",
      } as RequestInit & { duplex: "half" });

      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({
        error: "Chat request body exceeds size limit",
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

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
    expect(cancel).not.toHaveBeenCalled();
  });

  it("rejects a streamed body that exceeds the cap even with a lying header", async () => {
    const body = JSON.stringify({ messages: [], oversized: "x".repeat(128) });
    const { request, cancel } = streamRequest(
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
    expect(cancel).toHaveBeenCalledTimes(1);
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
