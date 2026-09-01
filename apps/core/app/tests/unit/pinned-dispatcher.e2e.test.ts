// @vitest-environment node

// No dns mocking here: this exercises the dispatcher against a real socket to
// prove the pinned lookup is actually applied by fetch. A unit test on the
// lookup callback alone would still pass if the dispatcher were never wired in.

import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPinnedDispatcher } from "~/lib/net/pinned-dispatcher.server";

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("reached");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("pinned dispatcher (real socket)", () => {
  it("blocks a hostname that resolves to loopback instead of connecting", async () => {
    // "localhost" resolves through the hosts file, so this needs no network.
    const reachedWithoutGuard = await fetch(`http://localhost:${port}/`);
    expect(await reachedWithoutGuard.text()).toBe("reached");

    // Same reachable server, now through the pinned dispatcher.
    await expect(
      fetch(`http://localhost:${port}/`, {
        dispatcher: getPinnedDispatcher(),
      } as RequestInit & { dispatcher: unknown }),
    ).rejects.toThrow();
  });

  it("reports the guard's reason as the failure cause", async () => {
    try {
      await fetch(`http://localhost:${port}/`, {
        dispatcher: getPinnedDispatcher(),
      } as RequestInit & { dispatcher: unknown });
      throw new Error("expected the pinned dispatcher to reject the connection");
    } catch (error) {
      const cause = (error as { cause?: unknown }).cause;
      const message = cause instanceof Error ? cause.message : String(cause);
      expect(message).toMatch(/disallowed network address/);
    }
  });

  it("does not apply to IP literals, which skip DNS resolution entirely", async () => {
    // Documents a real limit of connection pinning: net.connect only calls the
    // lookup for names, so a literal reaches the socket unchecked. Literals are
    // covered by parseAndValidateCanvasUrl at save time and by the pre-flight
    // host check at request time — the pin is specifically the anti-rebinding
    // layer, and rebinding requires a name. If this ever starts failing, undici
    // began resolving literals and the pin got strictly stronger.
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      dispatcher: getPinnedDispatcher(),
    } as RequestInit & { dispatcher: unknown });

    expect(response.status).toBe(200);
  });
});
