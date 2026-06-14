import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CanvasApiError,
  CanvasVerificationError,
  listCanvasCourseStudents,
  parseAndValidateCanvasUrl,
  verifyCanvasCredentials,
} from "~/lib/canvas/client.server";

describe("parseAndValidateCanvasUrl", () => {
  it("allows https URLs", () => {
    const url = parseAndValidateCanvasUrl("https://canvas.ubc.ca");
    expect(url.origin).toBe("https://canvas.ubc.ca");
  });

  it("allows http for localhost", () => {
    const url = parseAndValidateCanvasUrl("http://localhost:8080");
    expect(url.origin).toBe("http://localhost:8080");
  });

  it("allows http for canvas.docker", () => {
    const url = parseAndValidateCanvasUrl("http://canvas.docker");
    expect(url.hostname).toBe("canvas.docker");
  });

  it("rejects http for non-local hosts", () => {
    expect(() => parseAndValidateCanvasUrl("http://canvas.ubc.ca")).toThrow(
      CanvasVerificationError,
    );
  });
});

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

describe("listCanvasCourseStudents test mode", () => {
  it("returns mock roster for course 1", async () => {
    const students = await listCanvasCourseStudents(
      { canvasUrl: "http://localhost:8080", apiKey: "test", isTestMode: true },
      "1",
    );

    expect(students).toHaveLength(2);
    expect(students[0]?.sis_user_id).toBe("student_1");
  });
});

describe("CanvasApiError", () => {
  it("carries statusCode", () => {
    const error = new CanvasApiError("Canvas API error: 500", 500);
    expect(error.statusCode).toBe(500);
  });
});
