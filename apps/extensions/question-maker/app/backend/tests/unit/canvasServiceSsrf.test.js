/**
 * Defense-in-depth SSRF guard test (#991): even an already-persisted Canvas
 * integration row (saved before the connect-time guard existed, or altered
 * directly in the DB) must not be used to make an outbound request to a
 * private/link-local/loopback target or a non-HTTPS URL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const axiosRequest = vi.fn();
const integrationFindOne = vi.fn();

vi.mock("axios", () => ({
  default: axiosRequest,
}));

vi.mock("../../src/services/assessmentService.js", () => ({
  getAssessmentById: vi.fn(),
  createAssessment: vi.fn(),
}));
vi.mock("../../src/services/questionService.js", () => ({ createQuestion: vi.fn() }));
vi.mock("../../src/services/assessmentSectionService.js", () => ({
  createAssessmentSection: vi.fn(),
}));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    canvasIntegration: { findUnique: integrationFindOne },
    canvasCourseMapping: { findUnique: vi.fn(), create: vi.fn() },
    questionMetadata: {},
    variants: {},
    assessmentSections: {},
    sectionVariants: {},
    course: {},
  },
}));

const { getCanvasCourses } = await import("../../src/services/canvasService.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("makeCanvasRequest — SSRF re-validation at request time (#991)", () => {
  it.each([
    ["cloud metadata IP", "https://169.254.169.254"],
    ["loopback IP", "https://127.0.0.1"],
    ["non-HTTPS scheme", "http://canvas.example.com"],
  ])("rejects a stored canvasUrl targeting %s without calling axios", async (_label, canvasUrl) => {
    integrationFindOne.mockResolvedValue({
      isTestMode: false,
      canvasUrl,
      apiKey: "secret-token",
    });

    await expect(getCanvasCourses(42)).rejects.toThrow();
    expect(axiosRequest).not.toHaveBeenCalled();
  });

  it("allows a valid stored https canvasUrl through to axios", async () => {
    integrationFindOne.mockResolvedValue({
      isTestMode: false,
      canvasUrl: "https://canvas.example.edu",
      apiKey: "secret-token",
    });
    axiosRequest.mockResolvedValue({ data: [] });

    await expect(getCanvasCourses(42)).resolves.toEqual([]);
    expect(axiosRequest).toHaveBeenCalled();
    expect(axiosRequest.mock.calls[0][0].url).toBe(
      'https://canvas.example.edu/api/v1/courses?enrollment_type=teacher&enrollment_role=TeacherEnrollment',
    );
  });

  it('rejects a stored base URL with a path instead of letting string concatenation alter the API target', async () => {
    integrationFindOne.mockResolvedValue({
      isTestMode: false,
      canvasUrl: 'https://canvas.example.edu/tenant',
      apiKey: 'secret-token',
    });

    await expect(getCanvasCourses(42)).rejects.toThrow();
    expect(axiosRequest).not.toHaveBeenCalled();
  });

  it('does not expose a Canvas response body through the stable service error', async () => {
    const bodyCanary = 'AUDIT_CANVAS_ERROR_BODY_CANARY_e4f601';
    integrationFindOne.mockResolvedValue({
      isTestMode: false,
      canvasUrl: 'https://canvas.example.edu',
      apiKey: 'secret-token',
    });
    axiosRequest.mockRejectedValue(
      Object.assign(new Error(`request failed ${bodyCanary}`), {
        response: {
          status: 502,
          statusText: `Bad Gateway ${bodyCanary}`,
          data: { message: bodyCanary },
          headers: { authorization: `Bearer ${bodyCanary}` },
        },
      }),
    );

    const thrown = await getCanvasCourses(42).catch((error) => error);

    expect(thrown.message).toBe('Failed to get Canvas courses: Canvas API error (502)');
    expect(thrown.message).not.toContain(bodyCanary);
  });

  it('pins the DNS lookup and re-validates each redirect hop, so a resolved/redirected private address cannot be reached', async () => {
    integrationFindOne.mockResolvedValue({
      isTestMode: false,
      canvasUrl: "https://canvas.example.edu",
      apiKey: "secret-token",
    });
    axiosRequest.mockResolvedValue({ data: [] });

    await getCanvasCourses(42);

    const requestConfig = axiosRequest.mock.calls[0][0];
    expect(requestConfig.maxRedirects).toBeGreaterThan(0);
    expect(typeof requestConfig.lookup).toBe("function");
    expect(typeof requestConfig.beforeRedirect).toBe("function");
  });

  it.each([
    ["a private IP", { protocol: "https:", hostname: "169.254.169.254", path: "/api/v1/courses" }],
    [
      "a downgrade to http",
      { protocol: "http:", hostname: "canvas.example.edu", path: "/api/v1/courses" },
    ],
  ])("beforeRedirect rejects a redirect hop targeting %s", async (_label, redirectOptions) => {
    integrationFindOne.mockResolvedValue({
      isTestMode: false,
      canvasUrl: "https://canvas.example.edu",
      apiKey: "secret-token",
    });
    axiosRequest.mockResolvedValue({ data: [] });

    await getCanvasCourses(42);

    const { beforeRedirect } = axiosRequest.mock.calls[0][0];
    expect(() => beforeRedirect(redirectOptions)).toThrow();
  });

  it("beforeRedirect allows a redirect hop to another valid https host", async () => {
    integrationFindOne.mockResolvedValue({
      isTestMode: false,
      canvasUrl: "https://canvas.example.edu",
      apiKey: "secret-token",
    });
    axiosRequest.mockResolvedValue({ data: [] });

    await getCanvasCourses(42);

    const { beforeRedirect } = axiosRequest.mock.calls[0][0];
    expect(() =>
      beforeRedirect({
        protocol: "https:",
        hostname: "canvas.example.edu",
        path: "/api/v1/courses/",
      }),
    ).not.toThrow();
  });

  it('beforeRedirect removes bearer authorization on a cross-origin redirect', async () => {
    integrationFindOne.mockResolvedValue({
      isTestMode: false,
      canvasUrl: 'https://canvas.example.edu',
      apiKey: 'secret-token',
    });
    axiosRequest.mockResolvedValue({ data: [] });
    await getCanvasCourses(42);

    const { beforeRedirect } = axiosRequest.mock.calls[0][0];
    const redirectOptions = {
      protocol: 'https:',
      hostname: 'canvas-cdn.example.edu',
      path: '/api/v1/courses',
      headers: { Authorization: 'Bearer secret-token', 'Content-Type': 'application/json' },
    };
    expect(() => beforeRedirect(redirectOptions)).not.toThrow();
    expect(redirectOptions.headers).not.toHaveProperty('Authorization');
  });

  it('beforeRedirect preserves bearer authorization for a same-origin Canvas redirect', async () => {
    integrationFindOne.mockResolvedValue({
      isTestMode: false,
      canvasUrl: 'https://canvas.example.edu',
      apiKey: 'secret-token',
    });
    axiosRequest.mockResolvedValue({ data: [] });
    await getCanvasCourses(42);

    const { beforeRedirect } = axiosRequest.mock.calls[0][0];
    const redirectOptions = {
      protocol: 'https:',
      hostname: 'canvas.example.edu',
      path: '/api/v1/courses/',
      headers: { Authorization: 'Bearer secret-token' },
    };
    beforeRedirect(redirectOptions);
    expect(redirectOptions.headers.Authorization).toBe('Bearer secret-token');
  });

  it('beforeRedirect re-brackets an IPv6 hostname before validating, so a public IPv6 hop is not wrongly rejected as malformed', async () => {
    integrationFindOne.mockResolvedValue({
      isTestMode: false,
      canvasUrl: "https://canvas.example.edu",
      apiKey: "secret-token",
    });
    axiosRequest.mockResolvedValue({ data: [] });

    await getCanvasCourses(42);

    const { beforeRedirect } = axiosRequest.mock.calls[0][0];
    // follow-redirects strips the [...] brackets before this callback runs.
    expect(() =>
      beforeRedirect({
        protocol: "https:",
        hostname: "2001:4860:4860::8888",
        path: "/api/v1/courses",
      }),
    ).not.toThrow();
  });

  it("beforeRedirect rejects a redirect hop to a private IPv6 hostname", async () => {
    integrationFindOne.mockResolvedValue({
      isTestMode: false,
      canvasUrl: "https://canvas.example.edu",
      apiKey: "secret-token",
    });
    axiosRequest.mockResolvedValue({ data: [] });

    await getCanvasCourses(42);

    const { beforeRedirect } = axiosRequest.mock.calls[0][0];
    expect(() =>
      beforeRedirect({ protocol: "https:", hostname: "fe80::1", path: "/api/v1/courses" }),
    ).toThrow();
  });
});
