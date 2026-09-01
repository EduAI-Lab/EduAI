/**
 * @file Guards the parent/child correlation the batched clone relies on.
 *
 * The clone writes one `createManyAndReturn` per tree level and pairs returned
 * row `i` with input row `i`. Prisma documents no ordering guarantee there, so
 * these tests drive the service with a fake client that hands rows back in
 * reverse order. A clone that trusted the returned order would attach lessons
 * and activities to the wrong parents here; an integration test cannot cover
 * this, because it cannot make Postgres permute its own `RETURNING` output.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/config/database.js", () => ({ prisma: {} }));

const { cloneCourseContent, cloneLessonsFromOffering } =
  await import("../../src/services/courseCloning.js");

const SOURCE_COURSE_ID = 1;
const OTHER_SOURCE_COURSE_ID = 2;
const TARGET_COURSE_ID = 9;

const SOURCE_TOPICS = [
  { id: "src-algebra", name: "Algebra", courseOfferingId: SOURCE_COURSE_ID },
  { id: "src-geometry", name: "Geometry", courseOfferingId: SOURCE_COURSE_ID },
  { id: "src-calculus", name: "Calculus", courseOfferingId: SOURCE_COURSE_ID },
];

const TARGET_TOPICS = [
  { id: "tgt-algebra", name: "Algebra" },
  { id: "tgt-geometry", name: "Geometry" },
  { id: "tgt-calculus", name: "Calculus" },
];

function sourceActivity({ title, secondaryTopicId }) {
  return {
    title,
    instructionsMd: `${title} instructions`,
    // Identical across activities, so a mis-correlation cannot be masked by position.
    position: 1,
    promptTemplateId: null,
    customPrompt: null,
    customPromptTitle: null,
    config: { kind: title },
    mainTopicId: "src-algebra",
    enableTeachMode: true,
    enableGuideMode: false,
    enableCustomMode: false,
    secondaryTopics: [{ topicId: secondaryTopicId }],
  };
}

// Ids are handed out in input order, then the rows are returned reversed.
const reversedIds = (rows, next) => rows.map(() => ({ id: next() })).reverse();

/**
 * Fake Prisma client whose `createManyAndReturn` deliberately reverses its rows.
 *
 * It exposes no `$transaction`, so the service runs its writes inline against
 * this object, which is also what an outer-transaction caller looks like.
 */
function makeReversingDb({ sourceModules = [], sourceLessons = [], targetModule = null } = {}) {
  const calls = { lessonRows: null, activityRows: null, joinRows: null, moduleRows: null };
  let nextModuleId = 101;
  let nextLessonId = 201;
  let nextActivityId = 301;

  return {
    calls,
    db: {
      module: {
        findMany: vi.fn(async () => sourceModules),
        findUnique: vi.fn(async () => targetModule),
        aggregate: vi.fn(async () => ({ _max: { position: null } })),
        createManyAndReturn: vi.fn(async ({ data }) => {
          calls.moduleRows = data;
          return reversedIds(data, () => nextModuleId++);
        }),
      },
      lesson: {
        findMany: vi.fn(async () => sourceLessons),
        aggregate: vi.fn(async () => ({ _max: { position: null } })),
        createManyAndReturn: vi.fn(async ({ data }) => {
          calls.lessonRows = data;
          return reversedIds(data, () => nextLessonId++);
        }),
      },
      activity: {
        createManyAndReturn: vi.fn(async ({ data }) => {
          calls.activityRows = data;
          return reversedIds(data, () => nextActivityId++);
        }),
      },
      topic: {
        findMany: vi.fn(async ({ where }) =>
          where.courseOfferingId === TARGET_COURSE_ID ? TARGET_TOPICS : SOURCE_TOPICS,
        ),
        createManyAndReturn: vi.fn(async () => []),
      },
      activitySecondaryTopic: {
        createMany: vi.fn(async ({ data }) => {
          calls.joinRows = data;
          return { count: data.length };
        }),
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cloneCourseContent — returned row correlation", () => {
  // Two modules, one lesson each, one activity each. Titles differ but every
  // position collides, so only the returned ids can carry the correlation.
  const sourceModules = [
    {
      id: 11,
      title: "Module A",
      description: null,
      position: 1,
      lessons: [
        {
          id: 21,
          title: "Lesson A1",
          contentMd: "a",
          position: 1,
          activities: [sourceActivity({ title: "Activity A", secondaryTopicId: "src-geometry" })],
        },
      ],
    },
    {
      id: 12,
      title: "Module B",
      description: null,
      position: 2,
      lessons: [
        {
          id: 22,
          title: "Lesson B1",
          contentMd: "b",
          position: 1,
          activities: [sourceActivity({ title: "Activity B", secondaryTopicId: "src-calculus" })],
        },
      ],
    },
  ];

  it("attaches lessons to the right module when created rows come back permuted", async () => {
    const { db, calls } = makeReversingDb({ sourceModules });

    await cloneCourseContent(SOURCE_COURSE_ID, TARGET_COURSE_ID, {}, db);

    const byTitle = Object.fromEntries(calls.lessonRows.map((row) => [row.title, row.moduleId]));
    // Module A was inserted first, so it owns id 101 regardless of return order.
    expect(byTitle["Lesson A1"]).toBe(101);
    expect(byTitle["Lesson B1"]).toBe(102);
  });

  it("attaches activities to the right lesson when created rows come back permuted", async () => {
    const { db, calls } = makeReversingDb({ sourceModules });

    await cloneCourseContent(SOURCE_COURSE_ID, TARGET_COURSE_ID, {}, db);

    const byTitle = Object.fromEntries(calls.activityRows.map((row) => [row.title, row.lessonId]));
    expect(byTitle["Activity A"]).toBe(201);
    expect(byTitle["Activity B"]).toBe(202);
  });

  it("writes secondary-topic join rows against the right activity", async () => {
    const { db, calls } = makeReversingDb({ sourceModules });

    await cloneCourseContent(SOURCE_COURSE_ID, TARGET_COURSE_ID, {}, db);

    expect(calls.joinRows).toEqual([
      { activityId: 301, topicId: "tgt-geometry" },
      { activityId: 302, topicId: "tgt-calculus" },
    ]);
  });

  it("aborts when a level returns fewer rows than it was given", async () => {
    const { db } = makeReversingDb({ sourceModules });
    db.module.createManyAndReturn.mockResolvedValueOnce([{ id: 101 }]);

    await expect(cloneCourseContent(SOURCE_COURSE_ID, TARGET_COURSE_ID, {}, db)).rejects.toThrow(
      /Clone wrote 1 modules but expected 2/,
    );
  });
});

describe("cloneLessonsFromOffering — returned row correlation", () => {
  // Lessons drawn from two different source courses, again with colliding positions.
  const sourceLessons = [
    {
      id: 31,
      title: "Imported A",
      contentMd: "a",
      position: 1,
      module: { courseOfferingId: SOURCE_COURSE_ID },
      activities: [sourceActivity({ title: "Activity A", secondaryTopicId: "src-geometry" })],
    },
    {
      id: 32,
      title: "Imported B",
      contentMd: "b",
      position: 1,
      module: { courseOfferingId: OTHER_SOURCE_COURSE_ID },
      activities: [sourceActivity({ title: "Activity B", secondaryTopicId: "src-calculus" })],
    },
  ];

  it("attaches activities to the right lesson when created rows come back permuted", async () => {
    const { db, calls } = makeReversingDb({
      sourceLessons,
      targetModule: { courseOfferingId: TARGET_COURSE_ID },
    });

    await cloneLessonsFromOffering([31, 32], 77, db);

    const byTitle = Object.fromEntries(calls.activityRows.map((row) => [row.title, row.lessonId]));
    expect(byTitle["Activity A"]).toBe(201);
    expect(byTitle["Activity B"]).toBe(202);
    expect(calls.joinRows).toEqual([
      { activityId: 301, topicId: "tgt-geometry" },
      { activityId: 302, topicId: "tgt-calculus" },
    ]);
  });

  it("loads every source course's topics in a single read", async () => {
    const { db } = makeReversingDb({
      sourceLessons,
      targetModule: { courseOfferingId: TARGET_COURSE_ID },
    });

    await cloneLessonsFromOffering([31, 32], 77, db);

    const sourceRead = db.topic.findMany.mock.calls.find(
      ([args]) => args.where.courseOfferingId?.in !== undefined,
    );
    expect(sourceRead[0].where.courseOfferingId.in).toEqual([
      SOURCE_COURSE_ID,
      OTHER_SOURCE_COURSE_ID,
    ]);
  });
});
