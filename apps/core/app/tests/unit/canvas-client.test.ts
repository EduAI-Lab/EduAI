import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CanvasApiError,
  CanvasVerificationError,
  computeCanvasFilePublishState,
  downloadCanvasFile,
  listCanvasCourseStudents,
  parseAndValidateCanvasUrl,
  resolveCanvasFileDownloadUrl,
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

describe("resolveCanvasFileDownloadUrl", () => {
  it("rewrites file host to the configured Canvas URL origin", () => {
    expect(
      resolveCanvasFileDownloadUrl(
        "http://canvas.docker/files/99/download?verify=abc",
        "http://localhost:8080",
      ),
    ).toBe("http://localhost:8080/files/99/download?verify=abc");
  });
});

describe("downloadCanvasFile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads via rewritten URL using the Canvas API token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("file bytes", { status: 200 })),
    );

    const bytes = await downloadCanvasFile(
      { canvasUrl: "http://localhost:8080", apiKey: "1234~token", isTestMode: false },
      {
        id: 99,
        url: "http://canvas.docker/files/99/download?verify=abc",
        filename: "assignment2.md",
        "content-type": "text/markdown",
      },
    );

    expect(Buffer.from(bytes).toString()).toBe("file bytes");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/files/99/download?verify=abc",
      expect.objectContaining({
        headers: { Authorization: "Bearer 1234~token" },
        redirect: "manual",
      }),
    );
  });

  it("rewrites canvas.docker redirects to the configured Canvas origin", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 302,
            headers: {
              Location:
                "http://canvas.docker/files/1/download?download_frd=1&sf_verifier=abc",
            },
          }),
        )
        .mockResolvedValueOnce(new Response("redirected bytes", { status: 200 })),
    );

    const bytes = await downloadCanvasFile(
      { canvasUrl: "http://localhost:8080", apiKey: "1234~token", isTestMode: false },
      {
        id: 1,
        url: "http://localhost:8080/files/1/download?download_frd=1",
        filename: "assignment2.md",
        "content-type": "text/markdown",
      },
    );

    expect(Buffer.from(bytes).toString()).toBe("redirected bytes");
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8080/files/1/download?download_frd=1",
      expect.any(Object),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8080/files/1/download?download_frd=1&sf_verifier=abc",
      expect.any(Object),
    );
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

describe("computeCanvasFilePublishState", () => {
  const now = new Date("2026-07-05T12:00:00.000Z");

  it("treats a plain file with no lock fields as published", () => {
    expect(computeCanvasFilePublishState({}, now)).toEqual({ isPublished: true });
  });

  it("treats hidden as unpublished", () => {
    expect(computeCanvasFilePublishState({ hidden: true }, now)).toEqual({ isPublished: false });
  });

  it("treats locked as unpublished", () => {
    expect(computeCanvasFilePublishState({ locked: true }, now)).toEqual({ isPublished: false });
  });

  it("treats a future unlock_at as unpublished", () => {
    expect(
      computeCanvasFilePublishState({ unlock_at: "2026-07-06T00:00:00.000Z" }, now),
    ).toEqual({ isPublished: false });
  });

  it("treats a past unlock_at as published", () => {
    expect(
      computeCanvasFilePublishState({ unlock_at: "2026-07-01T00:00:00.000Z" }, now),
    ).toEqual({ isPublished: true });
  });

  it("treats a past lock_at as unpublished", () => {
    expect(
      computeCanvasFilePublishState({ lock_at: "2026-07-01T00:00:00.000Z" }, now),
    ).toEqual({ isPublished: false });
  });

  it("treats a future lock_at as still published", () => {
    expect(
      computeCanvasFilePublishState({ lock_at: "2026-07-06T00:00:00.000Z" }, now),
    ).toEqual({ isPublished: true });
  });
});
