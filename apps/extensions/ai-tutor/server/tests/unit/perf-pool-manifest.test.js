import { describe, it, expect } from "vitest";
import { previousCourseId, PERF_POOL_MANIFEST_KIND } from "../../prisma/perf-pool-manifest.js";

// The perf seed re-reads `.perf-pool/aitutor.json` to find the previous pool
// before reseeding. `previousCourseId` is the gate that decides whether a
// manifest is safe to delete from; these tests pin that selection rule, with
// particular attention to the safety boundary: a corrupted or attacker-controlled
// manifest must not be able to nominate an arbitrary existing CourseOffering.

function currentManifest(overrides = {}) {
  return {
    manifestKind: PERF_POOL_MANIFEST_KIND,
    generatedAt: "2026-08-20T00:00:00.000Z",
    poolSize: 15,
    instructorUserId: "seed_user_instructor_cs",
    studentUserId: "seed_user_student_01",
    courseId: 42,
    topicId: 7,
    poolModulesReuse: [11, 12],
    poolModulesDrop: [13, 14],
    poolLessonsReuse: [21, 22],
    poolLessonsDrop: [23, 24],
    poolActivitiesReuse: [31, 32],
    poolActivitiesDrop: [33, 34],
    seededModuleId: 11,
    seededLessonId: 21,
    seededActivityId: 31,
    seededChatId: "perf-pool-chat-42",
    ...overrides,
  };
}

function legacyManifest(overrides = {}) {
  return {
    generatedAt: "2026-08-20T00:00:00.000Z",
    poolSize: 15,
    instructorUserId: "seed_user_instructor_cs",
    studentUserId: "seed_user_student_01",
    nativeCourseId: 7,
    nativeTopicId: 9,
    poolModulesReuse: [11, 12],
    poolModulesDrop: [13, 14],
    poolLessonsReuse: [21, 22],
    poolLessonsDrop: [23, 24],
    poolActivitiesReuse: [31, 32],
    poolActivitiesDrop: [33, 34],
    enrollDropUserIds: ["perf_user_del_0000"],
    enrollRoleUserIds: ["perf_user_role_0000"],
    seededModuleId: 11,
    seededLessonId: 21,
    seededActivityId: 31,
    seededChatId: "perf-pool-chat-7",
    ...overrides,
  };
}

describe("perf pool manifest cleanup selection", () => {
  it("returns the course id from a valid current-format manifest", () => {
    expect(previousCourseId(currentManifest())).toBe(42);
  });

  it("returns the nativeCourseId from a complete legacy pre-#1072 manifest", () => {
    expect(previousCourseId(legacyManifest())).toBe(7);
  });

  it("rejects non-object manifests", () => {
    expect(previousCourseId(null)).toBeNull();
    expect(previousCourseId(undefined)).toBeNull();
    expect(previousCourseId("x")).toBeNull();
    expect(previousCourseId(42)).toBeNull();
    expect(previousCourseId([1, 2])).toBeNull();
  });

  it("rejects the exact reviewer counterexample (courseId + empty pool array)", () => {
    expect(previousCourseId({ courseId: 42, poolModulesReuse: [] })).toBeNull();
  });

  it("rejects a real course id with no ownership marker", () => {
    expect(previousCourseId({ courseId: 42 })).toBeNull();
    expect(previousCourseId({ courseId: 42, somethingElse: true })).toBeNull();
    // The full pool shape without the marker is still not owned by this seed.
    expect(previousCourseId(currentManifest({ manifestKind: undefined }))).toBeNull();
  });

  it("rejects a wrong ownership marker", () => {
    expect(
      previousCourseId(currentManifest({ manifestKind: "question-maker-perf-pool" })),
    ).toBeNull();
    expect(previousCourseId(currentManifest({ manifestKind: "" }))).toBeNull();
    expect(previousCourseId(currentManifest({ manifestKind: 42 }))).toBeNull();
  });

  it("rejects incomplete generated manifests", () => {
    expect(previousCourseId(currentManifest({ topicId: undefined }))).toBeNull();
    expect(previousCourseId(currentManifest({ generatedAt: undefined }))).toBeNull();
    expect(previousCourseId(currentManifest({ poolSize: undefined }))).toBeNull();
    expect(previousCourseId(currentManifest({ seededChatId: undefined }))).toBeNull();
    expect(previousCourseId(currentManifest({ seededActivityId: undefined }))).toBeNull();
    // A marker plus a course id is not a generated manifest.
    expect(previousCourseId({ manifestKind: PERF_POOL_MANIFEST_KIND, courseId: 42 })).toBeNull();
  });

  it("rejects empty or malformed required collections", () => {
    expect(previousCourseId(currentManifest({ poolModulesReuse: [] }))).toBeNull();
    expect(previousCourseId(currentManifest({ poolLessonsReuse: [] }))).toBeNull();
    expect(previousCourseId(currentManifest({ poolActivitiesReuse: [] }))).toBeNull();
    expect(previousCourseId(currentManifest({ poolModulesReuse: [0] }))).toBeNull();
    expect(previousCourseId(currentManifest({ poolModulesReuse: ["11", 12] }))).toBeNull();
    expect(previousCourseId(currentManifest({ poolModulesReuse: "not-an-array" }))).toBeNull();
    expect(previousCourseId(currentManifest({ poolModulesDrop: ["13"] }))).toBeNull();
    expect(previousCourseId(currentManifest({ poolActivitiesDrop: [null] }))).toBeNull();
  });

  it("rejects malformed ids", () => {
    expect(previousCourseId(currentManifest({ courseId: "42" }))).toBeNull();
    expect(previousCourseId(currentManifest({ courseId: 0 }))).toBeNull();
    expect(previousCourseId(currentManifest({ courseId: -1 }))).toBeNull();
    expect(previousCourseId(currentManifest({ courseId: 4.5 }))).toBeNull();
    expect(previousCourseId(currentManifest({ topicId: 0 }))).toBeNull();
    expect(previousCourseId(currentManifest({ seededModuleId: -1 }))).toBeNull();
    expect(previousCourseId(currentManifest({ poolSize: 0 }))).toBeNull();
    expect(previousCourseId(currentManifest({ generatedAt: "not-a-date" }))).toBeNull();
    expect(previousCourseId(currentManifest({ seededChatId: "" }))).toBeNull();
  });

  it("rejects incomplete or malformed legacy manifests", () => {
    // A legacy id alone, or a legacy id plus one weak field, is not enough.
    expect(previousCourseId({ nativeCourseId: 7 })).toBeNull();
    expect(previousCourseId({ nativeCourseId: 7, poolModulesReuse: [1] })).toBeNull();
    expect(previousCourseId(legacyManifest({ nativeTopicId: undefined }))).toBeNull();
    expect(previousCourseId(legacyManifest({ enrollDropUserIds: undefined }))).toBeNull();
    expect(previousCourseId(legacyManifest({ enrollRoleUserIds: undefined }))).toBeNull();
    expect(previousCourseId(legacyManifest({ poolModulesReuse: [] }))).toBeNull();
    expect(previousCourseId(legacyManifest({ nativeCourseId: "7" }))).toBeNull();
    expect(previousCourseId(legacyManifest({ nativeCourseId: 0 }))).toBeNull();
    expect(previousCourseId(legacyManifest({ seededChatId: "" }))).toBeNull();
  });
});
