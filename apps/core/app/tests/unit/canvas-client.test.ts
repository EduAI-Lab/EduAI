import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasVerificationError, verifyCanvasCredentials } from "~/lib/canvas/client.server";

describe("verifyCanvasCredentials", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("succeeds when Canvas returns 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 200 })),
    );

    await expect(
      verifyCanvasCredentials("http://localhost:8080", "1234~token"),
    ).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/users/self/profile",
      expect.objectContaining({
        headers: { Authorization: "Bearer 1234~token" },
      }),
    );
  });

  it("throws 400 for invalid token responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(verifyCanvasCredentials("http://localhost:8080", "bad")).rejects.toMatchObject({
      message: "Invalid Canvas API token",
      statusCode: 400,
    });
  });

  it("throws 502 for other Canvas error statuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    await expect(verifyCanvasCredentials("http://localhost:8080", "token")).rejects.toMatchObject({
      message: "Canvas returned 500",
      statusCode: 502,
    });
  });

  it("throws 502 when Canvas is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await expect(verifyCanvasCredentials("http://localhost:8080", "token")).rejects.toMatchObject({
      message: "Could not reach Canvas",
      statusCode: 502,
    });
  });

  it("exports CanvasVerificationError with statusCode", () => {
    const error = new CanvasVerificationError("Invalid Canvas API token", 400);
    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(400);
  });
});
