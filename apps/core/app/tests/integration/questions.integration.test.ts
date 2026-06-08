import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Auth mock ---
vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));

// --- Prisma mock ---
vi.mock("~/lib/prisma.server", () => {
  const mock = {
    course: { findUnique: vi.fn() },
    courseTopic: { findUnique: vi.fn(), findMany: vi.fn() },
    question: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    questionSecondaryTopic: { createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { default: mock };
});

import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { loader as listLoader, action as postAction } from "~/routes/api/questions";
import { loader as getLoader, action as patchAction } from "~/routes/api/questions.$id";

const mockGetSession = auth.api.getSession as ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  course: { findUnique: ReturnType<typeof vi.fn> };
  courseTopic: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  question: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  questionSecondaryTopic: { createMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const VALID_KEY = "integration-service-key-test-xyz";
const COURSE_ID = "course-cuid-abc";
const TOPIC_ID = "topic-cuid-primary";
const QUESTION_ID = "question-cuid-xyz";

function makeListArgs(
  query: Record<string, string> = {},
  authorization?: string,
  sessionCookie?: string
) {
  const url = new URL("http://localhost/api/questions");
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const headers = new Headers();
  if (authorization) headers.set("Authorization", authorization);
  if (sessionCookie) headers.set("Cookie", sessionCookie);
  return {
    request: new Request(url.toString(), { method: "GET", headers }),
    params: {},
    context: {} as never,
  };
}

function makePostArgs(body: object, sessionCookie?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (sessionCookie) headers.set("Cookie", sessionCookie);
  return {
    request: new Request("http://localhost/api/questions", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    params: {},
    context: {} as never,
  };
}

function makeGetByIdArgs(id: string, authorization?: string, sessionCookie?: string) {
  const headers = new Headers();
  if (authorization) headers.set("Authorization", authorization);
  if (sessionCookie) headers.set("Cookie", sessionCookie);
  return {
    request: new Request(`http://localhost/api/questions/${id}`, { method: "GET", headers }),
    params: { id },
    context: {} as never,
  };
}

function makePatchArgs(
  id: string,
  body: object,
  authorization?: string,
  sessionCookie?: string
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization) headers.set("Authorization", authorization);
  if (sessionCookie) headers.set("Cookie", sessionCookie);
  return {
    request: new Request(`http://localhost/api/questions/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    }),
    params: { id },
    context: {} as never,
  };
}

const fakeQuestion = {
  id: QUESTION_ID,
  courseId: COURSE_ID,
  topicId: TOPIC_ID,
  content: "What is X?",
  type: "MCQ",
  difficulty: "MEDIUM",
  reasoningLevel: "FACTUAL",
  choices: [{ letter: "A", text: "Answer" }],
  answer: null,
  testable: false,
  idempotencyKey: null,
  deletedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  secondaryTopics: [],
};

const validPostBody = {
  courseId: COURSE_ID,
  topicId: TOPIC_ID,
  content: "What is X?",
  type: "MCQ",
  difficulty: "MEDIUM",
  reasoningLevel: "FACTUAL",
  choices: [{ letter: "A", text: "Answer" }],
  testable: false,
  secondaryTopicIds: [],
};

beforeEach(() => {
  vi.stubEnv("EDUAI_API_KEY", VALID_KEY);
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── GET /api/questions ──────────────────────────────────────────────────────

describe("GET /api/questions", () => {
  it("returns 400 MISSING_COURSE_ID when courseId absent (service key)", async () => {
    const res = await listLoader(makeListArgs({}, `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "MISSING_COURSE_ID" });
  });

  it("returns 403 INVALID_SERVICE_KEY for wrong key", async () => {
    const res = await listLoader(makeListArgs({ courseId: COURSE_ID }, "Bearer wrong-key"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "INVALID_SERVICE_KEY" });
  });

  it("returns 401 when no Authorization header and no session", async () => {
    const res = await listLoader(makeListArgs({ courseId: COURSE_ID }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for STUDENT session", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", role: "STUDENT" } });
    const res = await listLoader(makeListArgs({ courseId: COURSE_ID }, undefined, "session=abc"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
  });

  it("returns 404 COURSE_NOT_FOUND via service key", async () => {
    db.course.findUnique.mockResolvedValue(null);
    const res = await listLoader(makeListArgs({ courseId: COURSE_ID }, `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns 200 paginated list via service key", async () => {
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.question.findMany.mockResolvedValue([fakeQuestion]);
    db.question.count.mockResolvedValue(1);

    const res = await listLoader(makeListArgs({ courseId: COURSE_ID }, `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ total: 1, limit: 100, offset: 0 });
    expect(body.questions).toHaveLength(1);
  });

  it("returns 200 via INSTRUCTOR session", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } });
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.question.findMany.mockResolvedValue([fakeQuestion]);
    db.question.count.mockResolvedValue(1);

    const res = await listLoader(makeListArgs({ courseId: COURSE_ID }, undefined, "session=abc"));
    expect(res.status).toBe(200);
  });

  it("forwards testable=true query param to DB WHERE clause", async () => {
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.question.findMany.mockResolvedValue([]);
    db.question.count.mockResolvedValue(0);

    await listLoader(makeListArgs({ courseId: COURSE_ID, testable: "true" }, `Bearer ${VALID_KEY}`));

    expect(db.question.findMany.mock.calls[0][0].where.testable).toBe(true);
  });
});

// ─── POST /api/questions ─────────────────────────────────────────────────────

describe("POST /api/questions", () => {
  it("returns 401 when no session", async () => {
    const res = await postAction(makePostArgs(validPostBody));
    expect(res.status).toBe(401);
  });

  it("returns 403 for STUDENT role", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", role: "STUDENT" } });
    const res = await postAction(makePostArgs(validPostBody, "session=abc"));
    expect(res.status).toBe(403);
  });

  it("returns 404 COURSE_NOT_FOUND", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } });
    db.course.findUnique.mockResolvedValue(null);
    const res = await postAction(makePostArgs(validPostBody, "session=abc"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns 404 TOPIC_NOT_FOUND when primary topic does not exist", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } });
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.courseTopic.findUnique.mockResolvedValue(null);
    const res = await postAction(makePostArgs(validPostBody, "session=abc"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "TOPIC_NOT_FOUND" });
  });

  it("returns 201 with ADMIN role (ADMIN is in the allowlist)", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", role: "ADMIN" } });
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.courseTopic.findUnique.mockResolvedValue({ id: TOPIC_ID, deletedAt: null });
    db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => {
      db.question.create.mockResolvedValue({ id: QUESTION_ID });
      return fn(db);
    });
    const res = await postAction(makePostArgs(validPostBody, "session=abc"));
    expect(res.status).toBe(201);
  });

  it("returns 422 DUPLICATE_TOPIC", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } });
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.courseTopic.findUnique.mockResolvedValue({ id: TOPIC_ID, deletedAt: null });
    const res = await postAction(
      makePostArgs({ ...validPostBody, secondaryTopicIds: [TOPIC_ID] }, "session=abc")
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("DUPLICATE_TOPIC");
  });

  it("returns 422 INVALID_TOPIC_IDS for soft-deleted secondary topic", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } });
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.courseTopic.findUnique.mockResolvedValue({ id: TOPIC_ID, deletedAt: null });
    db.courseTopic.findMany.mockResolvedValue([{ id: "sec-topic", deletedAt: new Date() }]);
    const res = await postAction(
      makePostArgs({ ...validPostBody, secondaryTopicIds: ["sec-topic"] }, "session=abc")
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("INVALID_TOPIC_IDS");
  });

  it("returns 201 with id on success and sets createdBy from session", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } });
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.courseTopic.findUnique.mockResolvedValue({ id: TOPIC_ID, deletedAt: null });
    db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => {
      db.question.create.mockResolvedValue({ id: QUESTION_ID });
      return fn(db);
    });
    const res = await postAction(makePostArgs(validPostBody, "session=abc"));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: QUESTION_ID });
    expect(db.question.create.mock.calls[0][0].data.createdBy).toBe("u1");
  });

  it("returns same id on idempotency key replay", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } });
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.courseTopic.findUnique.mockResolvedValue({ id: TOPIC_ID, deletedAt: null });
    db.question.findUnique.mockResolvedValue({ id: QUESTION_ID });
    const res = await postAction(
      makePostArgs({ ...validPostBody, idempotencyKey: "idem-replay-test" }, "session=abc")
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: QUESTION_ID });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

// ─── GET /api/questions/:id ──────────────────────────────────────────────────

describe("GET /api/questions/:id", () => {
  it("returns 403 INVALID_SERVICE_KEY for wrong key", async () => {
    const res = await getLoader(makeGetByIdArgs(QUESTION_ID, "Bearer wrong"));
    expect(res.status).toBe(403);
  });

  it("returns 401 when no auth", async () => {
    const res = await getLoader(makeGetByIdArgs(QUESTION_ID));
    expect(res.status).toBe(401);
  });

  it("returns 404 QUESTION_NOT_FOUND via service key", async () => {
    db.question.findFirst.mockResolvedValue(null);
    const res = await getLoader(makeGetByIdArgs(QUESTION_ID, `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "QUESTION_NOT_FOUND" });
  });

  it("returns 200 with question including secondaryTopics via service key", async () => {
    db.question.findFirst.mockResolvedValue(fakeQuestion);
    const res = await getLoader(makeGetByIdArgs(QUESTION_ID, `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(QUESTION_ID);
    expect(Array.isArray(body.secondaryTopics)).toBe(true);
  });

  it("returns 200 via user session (any role)", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", role: "STUDENT" } });
    db.question.findFirst.mockResolvedValue(fakeQuestion);
    const res = await getLoader(makeGetByIdArgs(QUESTION_ID, undefined, "session=abc"));
    expect(res.status).toBe(200);
  });
});

// ─── PATCH /api/questions/:id ────────────────────────────────────────────────

describe("PATCH /api/questions/:id", () => {
  it("returns 422 VALIDATION_ERROR when testable is a string", async () => {
    const res = await patchAction(
      makePatchArgs(QUESTION_ID, { testable: "yes" }, `Bearer ${VALID_KEY}`)
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("VALIDATION_ERROR");
    expect(body.fields.testable).toBeDefined();
  });

  it("returns 422 VALIDATION_ERROR when testable is null", async () => {
    const res = await patchAction(
      makePatchArgs(QUESTION_ID, { testable: null }, `Bearer ${VALID_KEY}`)
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("VALIDATION_ERROR");
  });

  it("returns 422 VALIDATION_ERROR when testable field is absent", async () => {
    const res = await patchAction(
      makePatchArgs(QUESTION_ID, {}, `Bearer ${VALID_KEY}`)
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("VALIDATION_ERROR");
  });

  it("returns 404 QUESTION_NOT_FOUND via service key", async () => {
    const { Prisma: PrismaLib } = await import("@prisma/client");
    const err = new PrismaLib.PrismaClientKnownRequestError("not found", {
      code: "P2025",
      clientVersion: "5.0.0",
    });
    db.question.update.mockRejectedValue(err);
    const res = await patchAction(
      makePatchArgs(QUESTION_ID, { testable: true }, `Bearer ${VALID_KEY}`)
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "QUESTION_NOT_FOUND" });
  });

  it("returns 200 with updated testable via service key", async () => {
    db.question.update.mockResolvedValue({ id: QUESTION_ID, testable: true });
    const res = await patchAction(
      makePatchArgs(QUESTION_ID, { testable: true }, `Bearer ${VALID_KEY}`)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: QUESTION_ID, testable: true });
  });

  it("returns 200 via INSTRUCTOR session", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", role: "INSTRUCTOR" } });
    db.question.update.mockResolvedValue({ id: QUESTION_ID, testable: true });
    const res = await patchAction(
      makePatchArgs(QUESTION_ID, { testable: true }, undefined, "session=abc")
    );
    expect(res.status).toBe(200);
  });

  it("returns 403 via STUDENT session", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", role: "STUDENT" } });
    const res = await patchAction(
      makePatchArgs(QUESTION_ID, { testable: true }, undefined, "session=abc")
    );
    expect(res.status).toBe(403);
  });
});

// ─── End-to-end flow ─────────────────────────────────────────────────────────

describe("end-to-end: POST → GET list → PATCH → GET /:id", () => {
  it("reflects testable change after patch", async () => {
    const instructorSession = { user: { id: "u1", role: "INSTRUCTOR" } };
    mockGetSession.mockResolvedValue(instructorSession);

    // POST
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.courseTopic.findUnique.mockResolvedValue({ id: TOPIC_ID, deletedAt: null });
    db.question.findUnique.mockResolvedValue(null);
    db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => {
      db.question.create.mockResolvedValue({ id: QUESTION_ID });
      return fn(db);
    });

    const postRes = await postAction(
      makePostArgs(
        { courseId: COURSE_ID, topicId: TOPIC_ID, content: "Q?", type: "SA", testable: false, secondaryTopicIds: [] },
        "session=abc"
      )
    );
    expect(postRes.status).toBe(201);
    const { id } = await postRes.json();

    // GET list
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.question.findMany.mockResolvedValue([{ ...fakeQuestion, id, testable: false }]);
    db.question.count.mockResolvedValue(1);

    const listRes = await listLoader(makeListArgs({ courseId: COURSE_ID }, `Bearer ${VALID_KEY}`));
    expect(listRes.status).toBe(200);
    expect((await listRes.json()).questions[0].id).toBe(id);

    // PATCH
    db.question.update.mockResolvedValue({ id, testable: true });
    const patchRes = await patchAction(makePatchArgs(id, { testable: true }, `Bearer ${VALID_KEY}`));
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).testable).toBe(true);

    // GET /:id
    db.question.findFirst.mockResolvedValue({ ...fakeQuestion, id, testable: true });
    const getRes = await getLoader(makeGetByIdArgs(id, `Bearer ${VALID_KEY}`));
    expect(getRes.status).toBe(200);
    expect((await getRes.json()).testable).toBe(true);
  });
});
