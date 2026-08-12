// @vitest-environment node
//
// PICT adapter (#1189, census docs/PICT_CENSUS.md § S10): cross-ext-push — Core
// half. Runs the real POST /api/questions action against the shared oracle.
// Draft skip and Core-unreachable cells are QM-client concerns and are skipped
// here; QM still covers those via cross-ext-push.pict.test.js.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@prisma/client";
import cases from "../../../../../tests/models/cross-ext-push.cases.json";
import {
  crossExtPushOracle,
  type CrossExtPushRow,
} from "../../../../../tests/models/cross-ext-push.oracle";

const prismaMock = vi.hoisted(() => ({
  idempotencyRecord: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: prismaMock,
}));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessGate: vi.fn(),
  stripAnswerForStudents: vi.fn((q) => q),
  wantsIncludeDeleted: vi.fn(() => false),
}));

vi.mock("~/lib/questions/server", () => ({
  createQuestion: vi.fn(),
  listQuestions: vi.fn(),
}));

import { action } from "~/routes/api/questions";
import { auth } from "~/lib/auth/server";
import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import { createQuestion } from "~/lib/questions/server";
import {
  bodyForIdempotencyHash,
  hashRequestBody,
} from "~/lib/idempotency.server";

const rows = (cases as CrossExtPushRow[]).filter(
  (row) => row.Draft === "no" && row.CoreReachable === "yes",
);

const USER = { id: "user-1", role: "INSTRUCTOR" };
const BODY = {
  courseId: "c1",
  topicId: "t1",
  content: "What is PICT?",
  type: "SA" as const,
  idempotencyKey: "k1",
};

function accessFor(row: CrossExtPushRow) {
  if (row.CourseAccess === "course-missing") {
    return { course: null, access: null };
  }
  if (row.CourseAccess === "forbidden") {
    return {
      course: { id: "c1" },
      access: { level: "student" as const, rank: 0 as const },
    };
  }
  return {
    course: { id: "c1" },
    access: { level: "instructor" as const, rank: 2 as const },
  };
}

function makeRequest(row: CrossExtPushRow): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Idempotency-Key": "k1",
  };
  if (row.Session === "present") {
    headers.cookie = "session=abc";
  }
  return new Request("http://localhost/api/questions", {
    method: "POST",
    headers,
    body: JSON.stringify(BODY),
  });
}

function requestHashForBody(): string {
  return hashRequestBody(bodyForIdempotencyHash(BODY));
}

function setupIdempotency(row: CrossExtPushRow) {
  const requestHash = requestHashForBody();

  if (row.Idempotency === "fresh") {
    prismaMock.idempotencyRecord.create.mockResolvedValue({});
    prismaMock.idempotencyRecord.update.mockResolvedValue({});
    vi.mocked(createQuestion).mockResolvedValue({ id: "q-new" });
    return;
  }

  prismaMock.idempotencyRecord.create.mockRejectedValue(
    new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002",
      clientVersion: "test",
    }),
  );

  if (row.Idempotency === "adopt-p2002") {
    // P2002 + COMPLETED matching hash → adopt/replay prior 201 (no createQuestion).
    prismaMock.idempotencyRecord.findUnique.mockResolvedValue({
      key: "k1",
      route: "POST /api/questions",
      actorId: USER.id,
      requestHash,
      status: "COMPLETED",
      statusCode: 201,
      responseBody: { id: "q-adopted" },
      expiresAt: new Date(Date.now() + 60_000),
    });
    return;
  }

  // in-progress: P2002 + PROCESSING forever → 409 after bounded wait
  prismaMock.idempotencyRecord.findUnique.mockResolvedValue({
    key: "k1",
    route: "POST /api/questions",
    actorId: USER.id,
    requestHash,
    status: "PROCESSING",
    statusCode: null,
    responseBody: null,
    expiresAt: new Date(Date.now() + 60_000),
  });
}

async function runCore(row: CrossExtPushRow): Promise<{ outcome: string }> {
  if (row.Session === "missing") {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
  } else {
    vi.mocked(auth.api.getSession).mockResolvedValue({ user: USER } as never);
  }

  vi.mocked(resolveCourseAccessGate).mockResolvedValue(accessFor(row) as never);

  if (row.Session === "present" && row.CourseAccess === "allowed") {
    setupIdempotency(row);
  }

  const run = action({
    request: makeRequest(row),
    params: {},
    context: {} as never,
  } as never);

  let res: Response;
  if (row.Idempotency === "in-progress" && row.Session === "present" && row.CourseAccess === "allowed") {
    vi.useFakeTimers();
    try {
      const pending = run;
      await vi.advanceTimersByTimeAsync(6_000);
      res = await pending;
    } finally {
      vi.useRealTimers();
    }
  } else {
    res = await run;
  }

  if (res.status === 401) return { outcome: "unauthorized-401" };
  if (res.status === 403) return { outcome: "forbidden-403" };
  if (res.status === 404) return { outcome: "not-found-404" };
  if (res.status === 409) return { outcome: "conflict-409" };
  if (res.status === 503) return { outcome: "unavailable-503" };

  if (res.status === 201) {
    if (row.Idempotency === "adopt-p2002") {
      expect(createQuestion).not.toHaveBeenCalled();
      return { outcome: "adopt" };
    }
    expect(createQuestion).toHaveBeenCalled();
    return { outcome: "accept-201" };
  }

  throw new Error(`unexpected Core status ${res.status}: ${await res.text()}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe.each(rows.map((row, index) => ({ row, index })))(
  "cross-ext-push PICT Core row #$index",
  ({ row }) => {
    it(`${row.Session}/${row.CourseAccess}/${row.Idempotency} matches oracle`, async () => {
      const expected = crossExtPushOracle(row);
      const actual = await runCore(row);
      expect(actual.outcome).toBe(expected.outcome);
    });
  },
);
