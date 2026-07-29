import { afterEach, describe, expect, it, vi } from "vitest";

// Mock at the ssrf-guard module boundary
const { assertPublicHostnameMock } = vi.hoisted(() => ({
  assertPublicHostnameMock: vi.fn(async (_hostname: string) => {}),
}));

// Only the DNS-backed check is mocked; assertPublicIpLiteral is synchronous and
// does no I/O, so the real range logic runs.
vi.mock("~/lib/net/ssrf-guard.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/net/ssrf-guard.server")>()),
  assertPublicHostname: (hostname: string) => assertPublicHostnameMock(hostname),
}));

import {
  CanvasApiError,
  CanvasVerificationError,
  computeCanvasFilePublishState,
  downloadCanvasFile,
  getCanvasCourseWithTerm,
  listCanvasCourseStudents,
  listTeacherCanvasCourses,
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

  it("rejects https to private, loopback, and metadata IP literals", () => {
    for (const url of [
      "https://10.0.0.5",
      "https://192.168.1.1",
      "https://172.20.1.1",
      "https://127.0.0.1",
      "https://169.254.169.254",
      "https://100.64.0.1",
      "https://[::1]",
      "https://[fd00::1]",
    ]) {
      expect(() => parseAndValidateCanvasUrl(url), url).toThrow(CanvasVerificationError);
    }
  });

  it("rejects https to a loopback literal even though http://localhost is allowed for dev", () => {
    // The dev allowance is for the docker Canvas over plain http; it must not
    // become a general loopback exemption.
    expect(() => parseAndValidateCanvasUrl("https://localhost:8080")).toThrow(
      CanvasVerificationError,
    );
  });

  it("rejects the http dev-host allowance in production", () => {
    const original = process.env.NODE_ENV;
    try {
      vi.stubEnv("NODE_ENV", "production");
      expect(() => parseAndValidateCanvasUrl("http://canvas.docker")).toThrow(
        CanvasVerificationError,
      );
      expect(() => parseAndValidateCanvasUrl("http://localhost:8080")).toThrow(
        CanvasVerificationError,
      );
    } finally {
      vi.stubEnv("NODE_ENV", original ?? "test");
      vi.unstubAllEnvs();
    }
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

  it("does not follow redirects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await verifyCanvasCredentials("https://canvas.ubc.ca", "token");

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("refuses a 302 instead of following it to an unvalidated host", async () => {
    // Without redirect: "manual" undici would follow this to loopback, and the
    // pre-flight host check would never see the redirect target.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        }),
      ),
    );

    await expect(verifyCanvasCredentials("https://canvas.ubc.ca", "token")).rejects.toMatchObject({
      message: "Canvas redirected the request to an unvalidated host",
      statusCode: 502,
    });
  });

  it("pins the connection via a dispatcher for non-local hosts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await verifyCanvasCredentials("https://canvas.ubc.ca", "token");

    const init = vi.mocked(fetch).mock.calls[0]?.[1] as { dispatcher?: unknown };
    expect(init.dispatcher).toBeDefined();
  });

  it("does not pin the local dev Canvas host, whose address the guard would reject", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await verifyCanvasCredentials("http://canvas.docker", "token");

    const init = vi.mocked(fetch).mock.calls[0]?.[1] as { dispatcher?: unknown };
    expect(init.dispatcher).toBeUndefined();
  });
});

describe("SSRF guard for real Canvas requests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    assertPublicHostnameMock.mockReset();
    assertPublicHostnameMock.mockImplementation(async () => {});
  });

  it("verifyCanvasCredentials rejects when the host guard rejects the resolved address", async () => {
    assertPublicHostnameMock.mockRejectedValueOnce(
      new Error('Host "canvas.attacker.example" resolves to a disallowed network address'),
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      verifyCanvasCredentials("https://canvas.attacker.example", "token"),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("getCanvasCourseWithTerm rejects when the host guard rejects the resolved address", async () => {
    assertPublicHostnameMock.mockRejectedValueOnce(
      new Error('Host "canvas.attacker.example" resolves to a disallowed network address'),
    );
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      getCanvasCourseWithTerm(
        { canvasUrl: "https://canvas.attacker.example", apiKey: "token", isTestMode: false },
        "21",
      ),
    ).rejects.toThrow(CanvasApiError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("re-checks the guard on every call, not just once", async () => {
    // First call resolves public and succeeds; a later call for the same
    // stored canvasUrl resolves private (e.g. rebound) and must be rejected.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 200 })),
    );
    await expect(
      verifyCanvasCredentials("https://canvas.attacker.example", "token"),
    ).resolves.toBeUndefined();
    expect(assertPublicHostnameMock).toHaveBeenCalledTimes(1);

    assertPublicHostnameMock.mockRejectedValueOnce(new Error("resolves to a disallowed network address"));
    await expect(
      verifyCanvasCredentials("https://canvas.attacker.example", "token"),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(assertPublicHostnameMock).toHaveBeenCalledTimes(2);
  });

  it("allows a Canvas host once the guard resolves cleanly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 200 })),
    );

    await expect(verifyCanvasCredentials("https://canvas.ubc.ca", "token")).resolves.toBeUndefined();
    expect(assertPublicHostnameMock).toHaveBeenCalledWith("canvas.ubc.ca");
  });

  it("skips the host guard entirely for the allow-listed local-dev hosts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 200 })),
    );

    await expect(
      verifyCanvasCredentials("http://localhost:8080", "token"),
    ).resolves.toBeUndefined();
    expect(assertPublicHostnameMock).not.toHaveBeenCalled();
  });

  it("refuses a redirect on the paginated list path instead of following it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1:5432/" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listTeacherCanvasCourses({
        canvasUrl: "https://canvas.ubc.ca",
        apiKey: "token",
        isTestMode: false,
      }),
    ).rejects.toMatchObject({
      message: "Canvas redirected the request to an unvalidated host",
      statusCode: 502,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ redirect: "manual" }),
    );
  });

  it("does not let a pagination Link header pointing at loopback bypass the guard for a non-local-dev canvasUrl", async () => {
    // A public canvasUrl must not get the local-dev free pass just because a
    // later request URL (here, from a Canvas-controlled Link header) happens
    // to have a hostname that's on the local-dev allow-list.
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: 1, name: "Course 1" }]), {
        status: 200,
        headers: {
          link: '<http://127.0.0.1:11434/api/v1/courses?page=2>; rel="next"',
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    // First call is for the initial page (canvas.attacker.example itself,
    // resolved publicly); second is for the Link-header URL (127.0.0.1).
    assertPublicHostnameMock.mockResolvedValueOnce(undefined);
    assertPublicHostnameMock.mockRejectedValueOnce(
      new Error('Host "127.0.0.1" resolves to a disallowed network address'),
    );

    await expect(
      listTeacherCanvasCourses({
        canvasUrl: "https://canvas.attacker.example",
        apiKey: "token",
        isTestMode: false,
      }),
    ).rejects.toThrow(CanvasApiError);

    expect(assertPublicHostnameMock).toHaveBeenCalledWith("127.0.0.1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    expect(students[0]?.sis_user_id).toBe("10000001");
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

describe("getCanvasCourseWithTerm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests the single-course endpoint with include[]=term", async () => {
    const payload = {
      id: 21,
      name: "Software Engineering",
      course_code: "COSC 301",
      start_at: null,
      end_at: null,
      term: {
        id: 1,
        name: "Default Term",
        start_at: "2026-05-01T06:00:00Z",
        end_at: "2026-08-31T06:00:00Z",
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })),
    );

    const course = await getCanvasCourseWithTerm(
      { canvasUrl: "http://localhost:8080", apiKey: "token", isTestMode: false },
      "21",
    );

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/courses/21?include[]=term",
      expect.objectContaining({
        headers: { Authorization: "Bearer token" },
      }),
    );
    expect(course?.term?.start_at).toBe("2026-05-01T06:00:00Z");
  });

  it("returns null when Canvas responds 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(
      getCanvasCourseWithTerm(
        { canvasUrl: "http://localhost:8080", apiKey: "token", isTestMode: false },
        "999",
      ),
    ).resolves.toBeNull();
  });
});
