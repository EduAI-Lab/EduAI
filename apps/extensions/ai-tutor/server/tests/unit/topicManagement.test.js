import { beforeEach, describe, expect, it, vi } from "vitest";

const courseFindUnique = vi.fn();
const transaction = vi.fn();
const isCourseAdmin = vi.fn();

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    courseOffering: { findUnique: courseFindUnique },
    $transaction: transaction,
  },
}));

vi.mock("../../src/middleware/auth.js", () => ({
  isCourseAdmin: (...args) => isCourseAdmin(...args),
}));

const { ensureCourseTopicAccess, remapCourseTopics, TopicMutationError } =
  await import("../../src/services/topicManagement.js");

const user = { id: "instructor-1", role: "INSTRUCTOR" };
const course = { id: 20, instructors: [{ userId: user.id }], enrollments: [] };

beforeEach(() => {
  vi.clearAllMocks();
  courseFindUnique.mockResolvedValue(course);
  isCourseAdmin.mockResolvedValue(true);
});

describe("topic service boundaries", () => {
  it("keeps membership lookup out of the route layer", async () => {
    const result = await ensureCourseTopicAccess(20, user);

    expect(result).toEqual({ course, authorized: true, isInstructor: true });
    expect(courseFindUnique).toHaveBeenCalledWith({
      where: { id: 20 },
      include: { instructors: true, enrollments: true },
    });
  });

  it("admits course staff who hold no local membership row", async () => {
    // A UNIT_ADMIN is neither an assigned instructor nor an enrolled student,
    // so the local tables say nothing about them — `isCourseAdmin` is what
    // resolves their department scope against Core. Reading only the membership
    // rows used to 403 this role on a course inside its own unit, which cost
    // them the course hero's topic chips and blocked activity authoring
    // outright (the form refuses to save without a main topic).
    const unitAdmin = { id: "unit-admin-1", role: "UNIT_ADMIN", authorizedUnits: ["COSC"] };
    isCourseAdmin.mockResolvedValue(true);

    await expect(ensureCourseTopicAccess(20, unitAdmin)).resolves.toEqual({
      course,
      authorized: true,
      isInstructor: false,
    });
    expect(isCourseAdmin).toHaveBeenCalledWith(unitAdmin, course);
  });

  it("still refuses a stranger, and does not ask Core twice about a member", async () => {
    isCourseAdmin.mockResolvedValue(false);
    const outsider = { id: "someone-else", role: "UNIT_ADMIN", authorizedUnits: ["MATH"] };

    await expect(ensureCourseTopicAccess(20, outsider)).resolves.toMatchObject({
      authorized: false,
    });

    // The local rows answer the common cases on their own — an assigned
    // instructor must not cost a Core round trip on every topic read.
    isCourseAdmin.mockClear();
    await expect(ensureCourseTopicAccess(20, user)).resolves.toMatchObject({ authorized: true });
    expect(isCourseAdmin).not.toHaveBeenCalled();
  });

  it("rejects an empty remap payload as a stable mutation error", async () => {
    await expect(remapCourseTopics({ courseId: 20, user, body: {} })).rejects.toMatchObject({
      name: "TopicMutationError",
      status: 400,
      message: "No valid mappings provided",
    });
    expect(courseFindUnique).not.toHaveBeenCalled();
  });

  it("rejects a malformed mapping instead of applying the valid subset", async () => {
    await expect(
      remapCourseTopics({
        courseId: 20,
        user,
        body: {
          mappings: [
            { fromTopicId: "topic-a", toTopicId: "topic-b" },
            { fromTopicId: "", toTopicId: "topic-c" },
          ],
        },
      }),
    ).rejects.toMatchObject({
      name: "TopicMutationError",
      status: 400,
      message: "No valid mappings provided",
    });
    expect(courseFindUnique).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("performs the remap in a serializable transaction", async () => {
    const tx = {
      topic: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: "topic-a" }, { id: "topic-b" }])
          .mockResolvedValueOnce([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      activity: { updateMany: vi.fn() },
      activitySecondaryTopic: {
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn(),
        deleteMany: vi.fn(),
      },
    };
    transaction.mockImplementation(async (callback, options) => {
      expect(options).toEqual({ isolationLevel: "Serializable" });
      return callback(tx);
    });

    await remapCourseTopics({
      courseId: 20,
      user,
      body: { mappings: [{ fromTopicId: "topic-a", toTopicId: "topic-b" }] },
    });

    expect(tx.activity.updateMany).toHaveBeenCalledWith({
      where: {
        mainTopicId: "topic-a",
        lesson: { module: { courseOfferingId: 20 } },
      },
      data: { mainTopicId: "topic-b" },
    });
    expect(tx.topic.deleteMany).toHaveBeenCalled();
  });

  it("does not enter the transaction when course authorization fails", async () => {
    isCourseAdmin.mockResolvedValue(false);

    await expect(
      remapCourseTopics({
        courseId: 20,
        user,
        body: { mappings: [{ fromTopicId: "topic-a", toTopicId: "topic-b" }] },
      }),
    ).rejects.toBeInstanceOf(TopicMutationError);
    expect(transaction).not.toHaveBeenCalled();
  });
});
