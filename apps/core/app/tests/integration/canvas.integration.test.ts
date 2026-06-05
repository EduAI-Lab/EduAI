// @vitest-environment node

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/canvas/client.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/canvas/client.server")>();
  return {
    ...actual,
    verifyCanvasCredentials: vi.fn().mockResolvedValue(undefined),
  };
});

import { loader, action } from "~/routes/api/canvas.$";
import { auth } from "~/lib/auth/server";
import { verifyCanvasCredentials, CanvasVerificationError } from "~/lib/canvas/client.server";

const TEST_ENCRYPTION_KEY = "canvas-integration-test-key!!";

let instructorId: string;
let studentId: string;

function sessionFor(userId: string, role: string) {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: userId, role },
  } as never);
}

function noSession() {
  vi.mocked(auth.api.getSession).mockResolvedValue(null);
}

function makeArgs(method: string, subpath: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const args = {
    request: new Request(`http://localhost/api/canvas/${subpath}`, init),
    params: {} as Record<string, string>,
    context: {} as never,
  };
  return args;
}

async function call(method: string, subpath: string, body?: unknown) {
  const args = makeArgs(method, subpath, body);
  if (method === "GET" || method === "DELETE") {
    return loader(args);
  }
  return action(args);
}

beforeAll(async () => {
  vi.stubEnv("ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);

  const instructor = await prisma.user.create({
    data: {
      email: "canvas-instructor@test.com",
      name: "Canvas Instructor",
      role: "INSTRUCTOR",
      emailVerified: true,
    },
  });
  instructorId = instructor.id;

  const student = await prisma.user.create({
    data: {
      email: "canvas-student@test.com",
      name: "Canvas Student",
      role: "STUDENT",
      emailVerified: true,
    },
  });
  studentId = student.id;
});

afterAll(async () => {
  await prisma.canvasIntegration.deleteMany({
    where: { userId: { in: [instructorId, studentId] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [instructorId, studentId] } } });
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(verifyCanvasCredentials).mockResolvedValue(undefined);
  await prisma.canvasIntegration.deleteMany({
    where: { userId: { in: [instructorId, studentId] } },
  });
});

describe("Canvas API — auth", () => {
  it("returns 401 without a session", async () => {
    noSession();
    const res = await call("GET", "integration");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: "Unauthorized" });
  });

  it("returns 403 for STUDENT role", async () => {
    sessionFor(studentId, "STUDENT");
    const res = await call("GET", "integration");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: "Forbidden: instructors only" });
  });
});

describe("Canvas API — connect / integration / disconnect", () => {
  it("connects, returns status without apiKey, then disconnects", async () => {
    sessionFor(instructorId, "INSTRUCTOR");

    const connectRes = await call("POST", "connect", {
      canvasUrl: "http://localhost:8080",
      apiKey: "1234~test-token-secret",
    });
    expect(connectRes.status).toBe(200);
    const connectBody = await connectRes.json();
    expect(connectBody.success).toBe(true);
    expect(connectBody.data).toEqual({
      canvasUrl: "http://localhost:8080",
      isTestMode: false,
      isConnected: true,
    });
    expect(connectBody.data).not.toHaveProperty("apiKey");

    const row = await prisma.canvasIntegration.findUnique({ where: { userId: instructorId } });
    expect(row?.apiKey).toBeTruthy();
    expect(row?.apiKey).not.toBe("1234~test-token-secret");

    sessionFor(instructorId, "INSTRUCTOR");
    const getRes = await call("GET", "integration");
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.data).toEqual({
      canvasUrl: "http://localhost:8080",
      isTestMode: false,
      isConnected: true,
    });
    expect(JSON.stringify(getBody)).not.toContain("1234~test-token-secret");

    sessionFor(instructorId, "INSTRUCTOR");
    const disconnectRes = await call("DELETE", "disconnect");
    expect(disconnectRes.status).toBe(200);

    sessionFor(instructorId, "INSTRUCTOR");
    const afterRes = await call("GET", "integration");
    const afterBody = await afterRes.json();
    expect(afterBody.data).toBeNull();
    expect(afterBody.message).toBe("Canvas integration not configured");
  });

  it("allows test mode without apiKey", async () => {
    sessionFor(instructorId, "INSTRUCTOR");

    const res = await call("POST", "connect", {
      canvasUrl: "http://localhost:8080",
      isTestMode: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.isTestMode).toBe(true);
    expect(verifyCanvasCredentials).not.toHaveBeenCalled();
  });

  it("returns 400 when Canvas token verification fails", async () => {
    vi.mocked(verifyCanvasCredentials).mockRejectedValueOnce(
      new CanvasVerificationError("Invalid Canvas API token", 400),
    );
    sessionFor(instructorId, "INSTRUCTOR");

    const res = await call("POST", "connect", {
      canvasUrl: "http://localhost:8080",
      apiKey: "bad-token",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: "Invalid Canvas API token",
    });

    const row = await prisma.canvasIntegration.findUnique({ where: { userId: instructorId } });
    expect(row).toBeNull();
  });

  it("verifies credentials before saving in non-test mode", async () => {
    sessionFor(instructorId, "INSTRUCTOR");

    await call("POST", "connect", {
      canvasUrl: "http://localhost:8080",
      apiKey: "1234~test-token-secret",
    });

    expect(verifyCanvasCredentials).toHaveBeenCalledWith(
      "http://localhost:8080",
      "1234~test-token-secret",
    );
  });

  it("returns 404 for unknown subpaths", async () => {
    sessionFor(instructorId, "INSTRUCTOR");
    const res = await call("GET", "unknown");
    expect(res.status).toBe(404);
  });
});
