// @vitest-environment node
//
// Smoke test for the SSR request-handling shell in app/entry.server.tsx.
// `renderToPipeableStream` is mocked so the test drives handleRequest's own
// control flow (HEAD short-circuit, ready-event selection, error handling,
// timeout/abort) without depending on react-router's internal render
// machinery, which belongs to react-router's own test suite, not ours.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import type { EntryContext, HandleDocumentRequestFunction } from "react-router";

const renderToPipeableStreamMock = vi.hoisted(() => vi.fn());
const pipeMock = vi.hoisted(() => vi.fn());
const abortMock = vi.hoisted(() => vi.fn());

vi.mock("react-dom/server", () => ({
  renderToPipeableStream: renderToPipeableStreamMock,
}));

import handleRequestImport, { streamTimeout } from "~/entry.server";

// `loadContext`'s real param type depends on react-router's MiddlewareEnabled
// feature flag, which this test doesn't opt into — cast through `unknown` to
// pin the return type without fighting that param's conditional type.
const handleRequest = handleRequestImport as unknown as HandleDocumentRequestFunction;

const fakeRouterContext = { isSpaMode: false } as unknown as EntryContext;

function request(headers?: HeadersInit, method = "GET") {
  return new Request("http://core.test/dashboard", { method, headers });
}

/** The `RenderToPipeableStreamOptions` handleRequest most recently passed in. */
function lastRenderOptions(): RenderToPipeableStreamOptions {
  const call = renderToPipeableStreamMock.mock.calls.at(-1);
  return call?.[1] as RenderToPipeableStreamOptions;
}

beforeEach(() => {
  vi.clearAllMocks();
  renderToPipeableStreamMock.mockReturnValue({ pipe: pipeMock, abort: abortMock });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("handleRequest — HEAD requests", () => {
  it("returns an empty body without rendering", async () => {
    const response = await handleRequest(
      request(undefined, "HEAD"),
      200,
      new Headers(),
      fakeRouterContext,
      {} as never,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(renderToPipeableStreamMock).not.toHaveBeenCalled();
  });
});

describe("handleRequest — ready-event selection", () => {
  it("uses onShellReady for a regular browser user agent", async () => {
    const promise = handleRequest(
      request({
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      }),
      200,
      new Headers(),
      fakeRouterContext,
      {} as never,
    );

    const options = lastRenderOptions();
    expect(options.onShellReady).toBeTypeOf("function");
    expect(options.onAllReady).toBeUndefined();

    options.onShellReady!();
    const response = await promise;
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html");
    expect(pipeMock).toHaveBeenCalled();
  });

  it("uses onAllReady for a bot user agent", async () => {
    const promise = handleRequest(
      request({ "user-agent": "Googlebot" }),
      200,
      new Headers(),
      fakeRouterContext,
      {} as never,
    );

    const options = lastRenderOptions();
    expect(options.onAllReady).toBeTypeOf("function");
    expect(options.onShellReady).toBeUndefined();

    options.onAllReady!();
    await promise;
  });

  it("uses onAllReady in SPA mode regardless of user agent", async () => {
    const promise = handleRequest(
      request({ "user-agent": "Mozilla/5.0" }),
      200,
      new Headers(),
      { isSpaMode: true } as unknown as EntryContext,
      {} as never,
    );

    const options = lastRenderOptions();
    expect(options.onAllReady).toBeTypeOf("function");
    expect(options.onShellReady).toBeUndefined();

    options.onAllReady!();
    await promise;
  });

  it("passes the generated nonce to renderToPipeableStream", async () => {
    const promise = handleRequest(request(), 200, new Headers(), fakeRouterContext, {} as never);
    const options = lastRenderOptions();
    expect(options.nonce).toEqual(expect.any(String));
    expect(options.nonce!.length).toBeGreaterThan(0);

    options.onShellReady!();
    await promise;
  });
});

describe("handleRequest — errors", () => {
  it("rejects the promise on a shell error", async () => {
    const promise = handleRequest(request(), 200, new Headers(), fakeRouterContext, {} as never);
    const options = lastRenderOptions();
    const shellError = new Error("shell blew up");

    options.onShellError!(shellError);

    await expect(promise).rejects.toThrow("shell blew up");
  });

  it("logs a redacted error to the console once the shell has rendered", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const promise = handleRequest(request(), 200, new Headers(), fakeRouterContext, {} as never);
    const options = lastRenderOptions();

    options.onShellReady!();
    await promise;

    options.onError!(new Error("streamed render error"), {} as never);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("does not log to the console for an error before the shell has rendered", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const promise = handleRequest(request(), 200, new Headers(), fakeRouterContext, {} as never);
    const options = lastRenderOptions();

    // A non-fatal onError before shell-ready bumps the status but must not log
    // (it would be double-logged once the shell error / shell ready path runs).
    options.onError!(new Error("pre-shell error"), {} as never);
    expect(errorSpy).not.toHaveBeenCalled();

    options.onShellReady!();
    const response = await promise;
    expect(response.status).toBe(500);
  });
});

describe("handleRequest — stream timeout", () => {
  it("aborts the render if it never becomes ready", () => {
    vi.useFakeTimers();
    void handleRequest(request(), 200, new Headers(), fakeRouterContext, {} as never);

    vi.advanceTimersByTime(streamTimeout + 1000);

    expect(abortMock).toHaveBeenCalledTimes(1);
  });
});
