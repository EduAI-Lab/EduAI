/**
 * PICT adapter (#1186, census docs/PICT_CENSUS.md § S7): per generated row
 * from tests/models/create-question.cases.json, seeds a real course/topic
 * state and calls the real `createQuestion` against a real Postgres DB,
 * asserting against tests/models/create-question.oracle.ts.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import prisma from "~/lib/prisma.server";
import { createQuestion } from "~/lib/questions/server";
import { seedUser, seedCourse, cleanupRbac } from "../helpers/rbac";
import createQuestionCases from "../../../../../tests/models/create-question.cases.json";
import { createQuestionOracle, type CreateQuestionRow } from "../../../../../tests/models/create-question.oracle";

const rows = createQuestionCases as CreateQuestionRow[];

const userIds: string[] = [];
const courseIds: string[] = [];
const topicIds: string[] = [];

afterAll(async () => {
  await prisma.questionSecondaryTopic.deleteMany({
    where: { question: { courseId: { in: courseIds } } },
  });
  await prisma.question.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.courseTopic.deleteMany({ where: { id: { in: topicIds } } });
  await cleanupRbac({ userIds, courseIds });
  await prisma.$disconnect();
});

async function createTopic(courseId: string, opts: { deleted?: boolean } = {}) {
  const topic = await prisma.courseTopic.create({
    data: {
      courseId,
      name: `Topic ${randomUUID().slice(0, 8)}`,
      deletedAt: opts.deleted ? new Date() : null,
    },
  });
  topicIds.push(topic.id);
  return topic;
}

function nonexistentId(): string {
  return `missing-${randomUUID()}`;
}

/**
 * Topics live under `topicHomeCourseId` regardless of `row.Course` — a
 * submitted courseId that doesn't exist (or doesn't match) must not stop a
 * referenced topic from being a real, persisted row elsewhere, so the two
 * concerns stay independently testable.
 */
async function buildBody(
  row: CreateQuestionRow,
  submittedCourseId: string,
  topicHomeCourseId: string,
  creatorId: string,
) {
  let topicId: string;
  if (row.PrimaryTopic === "exists") {
    topicId = (await createTopic(topicHomeCourseId)).id;
  } else if (row.PrimaryTopic === "deleted") {
    topicId = (await createTopic(topicHomeCourseId, { deleted: true })).id;
  } else {
    topicId = nonexistentId();
  }

  let secondaryTopicIds: string[] = [];
  switch (row.SecondaryTopicIds) {
    case "none":
      secondaryTopicIds = [];
      break;
    case "valid":
      secondaryTopicIds = [(await createTopic(topicHomeCourseId)).id];
      break;
    case "duplicate-primary":
      secondaryTopicIds = [topicId];
      break;
    case "all-missing":
      secondaryTopicIds = [nonexistentId(), nonexistentId()];
      break;
    case "all-deleted":
      secondaryTopicIds = [(await createTopic(topicHomeCourseId, { deleted: true })).id];
      break;
    case "mixed-missing-and-deleted":
      secondaryTopicIds = [
        nonexistentId(),
        (await createTopic(topicHomeCourseId, { deleted: true })).id,
      ];
      break;
  }

  return {
    courseId: submittedCourseId,
    topicId,
    content: row.Validity === "valid" ? "PICT-generated question content" : "",
    type: row.Type,
    secondaryTopicIds,
    creatorId,
  };
}

describe.each(rows.map((row, index) => [index, row] as const))(
  "create-question PICT row #%i",
  (index, row) => {
    it(
      `${row.Validity}/${row.Course}/${row.PrimaryTopic}/${row.SecondaryTopicIds}/${row.Type} matches oracle`,
      async () => {
        const expected = createQuestionOracle(row);

        const creator = await seedUser({ role: "INSTRUCTOR" });
        userIds.push(creator.id);

        // Topics always live under a real course, independent of whether the
        // *submitted* courseId (below) resolves to anything.
        const topicHomeCourse = await seedCourse();
        courseIds.push(topicHomeCourse.id);

        const submittedCourseId = row.Course === "exists" ? topicHomeCourse.id : nonexistentId();

        const { creatorId, ...body } = await buildBody(
          row,
          submittedCourseId,
          topicHomeCourse.id,
          creator.id,
        );

        const result = await createQuestion(body, creatorId);

        if (expected.outcome === "SUCCESS") {
          expect("id" in result, JSON.stringify(result)).toBe(true);
          if ("id" in result) {
            const persisted = await prisma.question.findUniqueOrThrow({
              where: { id: result.id },
              include: { secondaryTopics: true },
            });
            expect(persisted.type).toBe(row.Type);
            expect(persisted.secondaryTopics.length).toBe(body.secondaryTopicIds.length);
          }
        } else {
          expect("error" in result, JSON.stringify(result)).toBe(true);
          if ("error" in result) expect(result.error).toBe(expected.outcome);
        }
      },
    );
  },
);
