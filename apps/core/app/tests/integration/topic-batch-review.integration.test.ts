// @vitest-environment node
//
// #1977 — batch approve / dismiss of topic suggestions through
// POST /api/courses/:courseId/topic-analysis, against the real test database.
//
// The session is mocked; access resolution, the review service, and every write
// run for real, so these assert what the rows look like after a batch.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import prisma from "~/lib/prisma.server";

const getRequestSession = vi.hoisted(() => vi.fn());
vi.mock("~/lib/auth/request-session.server", () => ({ getRequestSession }));

const { action } = await import("~/routes/api/courses.topic-analysis.$");

let courseId: string;
let userId: string;

type BatchBody = { action: "approveMany" | "dismissMany"; topicIds: string[] };

function post(body: BatchBody) {
  return {
    request: new Request(`http://localhost/api/courses/${courseId}/topic-analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { courseId },
    context: {} as never,
  } as never;
}

async function seedSuggestion(name: string) {
  return prisma.courseTopic.create({
    data: { courseId, name, origin: "AI", reviewStatus: "SUGGESTED", confidence: 0.7 },
  });
}

async function topicRow(id: string) {
  return prisma.courseTopic.findUniqueOrThrow({
    where: { id },
    select: { reviewStatus: true, deletedAt: true, deletedBy: true },
  });
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      email: "admin-topic-batch-review@test.com",
      name: "Topic Batch Review Admin",
      role: "ADMIN",
      emailVerified: false,
    },
  });
  userId = user.id;

  const course = await prisma.course.create({
    data: {
      name: "Topic Batch Review Course",
      code: "TBR 977",
      section: "001",
      term: "W1",
      year: 2026,
      startDate: new Date("2026-09-01"),
    },
  });
  courseId = course.id;
});

beforeEach(async () => {
  getRequestSession.mockResolvedValue({
    user: { id: userId, role: "ADMIN", email: "admin-topic-batch-review@test.com" },
  });
  await prisma.question.deleteMany({ where: { courseId } });
  await prisma.courseTopic.deleteMany({ where: { courseId } });
  // An accepted topic keeps the zero-topic fallback out of these assertions.
  await prisma.courseTopic.create({ data: { courseId, name: "Course basics", createdBy: userId } });
});

afterAll(async () => {
  await prisma.question.deleteMany({ where: { courseId } });
  await prisma.courseTopic.deleteMany({ where: { courseId } });
  await prisma.course.deleteMany({ where: { id: courseId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("batch topic review (#1977)", () => {
  it("approves every selected suggestion in one request, and only those", async () => {
    const [limits, series, untouched] = await Promise.all([
      seedSuggestion("Limits"),
      seedSuggestion("Series"),
      seedSuggestion("Integrals"),
    ]);

    const response = await action(
      post({ action: "approveMany", topicIds: [limits.id, series.id] }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.failed).toEqual([]);
    // Topics are reviewed in the order they were selected.
    expect(body.succeeded.map((topic: { id: string }) => topic.id)).toEqual([limits.id, series.id]);
    expect((await topicRow(limits.id)).reviewStatus).toBe("ACCEPTED");
    expect((await topicRow(series.id)).reviewStatus).toBe("ACCEPTED");
    expect((await topicRow(untouched.id)).reviewStatus).toBe("SUGGESTED");
  });

  it("dismisses every selected suggestion, attributing the actor", async () => {
    const [limits, series] = await Promise.all([
      seedSuggestion("Limits"),
      seedSuggestion("Series"),
    ]);

    const response = await action(
      post({ action: "dismissMany", topicIds: [limits.id, series.id] }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).failed).toEqual([]);
    for (const id of [limits.id, series.id]) {
      const row = await topicRow(id);
      expect(row.deletedAt).not.toBeNull();
      expect(row.deletedBy).toBe(userId);
    }
  });

  it("acts on the rest of the selection and reports the topics it could not", async () => {
    const [limits, withQuestion] = await Promise.all([
      seedSuggestion("Limits"),
      seedSuggestion("Derivatives"),
    ]);
    const accepted = await prisma.courseTopic.findFirstOrThrow({
      where: { courseId, name: "Course basics" },
    });
    await prisma.question.create({
      data: {
        courseId,
        topicId: withQuestion.id,
        createdBy: userId,
        content: "What is a derivative?",
        type: "SA",
      },
    });

    const response = await action(
      post({ action: "dismissMany", topicIds: [limits.id, withQuestion.id, accepted.id] }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.succeeded).toEqual([{ id: limits.id, name: "Limits" }]);
    expect(body.failed).toEqual([
      { topicId: withQuestion.id, error: "TOPIC_HAS_QUESTIONS" },
      // Not a suggestion: the batch must not touch an instructor's own topic.
      { topicId: accepted.id, error: "TOPIC_NOT_FOUND" },
    ]);
    expect((await topicRow(limits.id)).deletedAt).not.toBeNull();
    expect((await topicRow(withQuestion.id)).deletedAt).toBeNull();
    expect((await topicRow(accepted.id)).deletedAt).toBeNull();
  });
});
