import { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { validateCreateQuestion } from "~/lib/questions/schema";
import type { JsonValue } from "~/lib/json-value";

export type CreateQuestionBody = {
  courseId: string;
  topicId: string;
  content: string;
  type: "MCQ" | "SA" | "LA";
  difficulty?: "EASY" | "MEDIUM" | "HARD";
  reasoningLevel?: "FACTUAL" | "ANALYTICAL" | "APPLICATION";
  choices?: { letter: string; text: string }[];
  answer?: string;
  selectAllThatApply?: boolean;
  correctAnswers?: string[] | null;
  testable?: boolean;
  secondaryTopicIds?: string[];
};

type CreateQuestionError =
  | { error: "VALIDATION_ERROR"; fields: Record<string, string> }
  | { error: "COURSE_NOT_FOUND" }
  | { error: "TOPIC_NOT_FOUND" }
  | { error: "DUPLICATE_TOPIC"; conflictingIds: string[] }
  | { error: "INVALID_TOPIC_IDS"; deletedTopicIds: string[]; conflictingWithPrimary: string[] };

type CreateQuestionSuccess = { id: string };

const MAX_QUESTIONS_LIMIT = 500;
const MAX_QUESTIONS_OFFSET = 100_000;

function boundedInteger(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export async function createQuestion(
  body: JsonValue,
  createdBy: string,
): Promise<CreateQuestionError | CreateQuestionSuccess> {
  const parsed = validateCreateQuestion(body);
  if (!parsed.success) return parsed.error;

  const {
    courseId,
    topicId,
    content,
    type,
    difficulty = "MEDIUM",
    reasoningLevel = "FACTUAL",
    choices,
    answer,
    selectAllThatApply = false,
    correctAnswers,
    testable = false,
    secondaryTopicIds = [],
  } = parsed.data;

  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) return { error: "COURSE_NOT_FOUND" };

  const primaryTopic = await prisma.courseTopic.findUnique({
    where: { id: topicId },
    select: { id: true, courseId: true, deletedAt: true },
  });
  if (!primaryTopic || primaryTopic.deletedAt !== null || primaryTopic.courseId !== courseId) {
    return { error: "TOPIC_NOT_FOUND" };
  }

  const seenSecondaryTopicIds = new Set<string>();
  const duplicateSecondaryTopicIds = new Set<string>();
  for (const id of secondaryTopicIds) {
    if (seenSecondaryTopicIds.has(id)) duplicateSecondaryTopicIds.add(id);
    seenSecondaryTopicIds.add(id);
  }
  if (secondaryTopicIds.includes(topicId)) duplicateSecondaryTopicIds.add(topicId);
  if (duplicateSecondaryTopicIds.size > 0) {
    return {
      error: "DUPLICATE_TOPIC",
      conflictingIds: [...duplicateSecondaryTopicIds],
    };
  }

  if (secondaryTopicIds.length > 0) {
    const secondaryTopics = await prisma.courseTopic.findMany({
      where: { id: { in: secondaryTopicIds } },
      select: { id: true, courseId: true, deletedAt: true },
    });
    const topicsById = new Map(secondaryTopics.map((topic) => [topic.id, topic]));
    const invalidTopicIds = [...seenSecondaryTopicIds].filter((id) => {
      const topic = topicsById.get(id);
      return !topic || topic.deletedAt !== null || topic.courseId !== courseId;
    });
    if (invalidTopicIds.length > 0) {
      // Keep `deletedTopicIds` for extension API compatibility. The field is
      // the established remediation list for every unusable Core topic ID,
      // including missing and cross-course references.
      return {
        error: "INVALID_TOPIC_IDS",
        deletedTopicIds: invalidTopicIds,
        conflictingWithPrimary: [],
      };
    }
  }

  const question = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.question.create({
      data: {
        courseId,
        topicId,
        createdBy,
        content,
        type,
        difficulty,
        reasoningLevel,
        choices: choices ?? Prisma.JsonNull,
        answer,
        selectAllThatApply,
        correctAnswers: correctAnswers ?? Prisma.JsonNull,
        testable,
      },
    });
    if (secondaryTopicIds.length > 0) {
      await tx.questionSecondaryTopic.createMany({
        data: secondaryTopicIds.map((tid: string) => ({ questionId: created.id, topicId: tid })),
      });
    }
    return created;
  });

  return { id: question.id };
}

export type ListQuestionsParams = {
  courseId: string;
  topicId?: string;
  testable?: boolean;
  limit?: number;
  offset?: number;
  // §19 forensics opt-in (#315): ADMIN-only, gated at the route layer.
  includeDeleted?: boolean;
};

export async function listQuestions(params: ListQuestionsParams) {
  const { courseId, topicId, testable, limit = 100, offset = 0, includeDeleted = false } = params;
  const safeLimit = boundedInteger(limit, 100, 1, MAX_QUESTIONS_LIMIT);
  const safeOffset = boundedInteger(offset, 0, 0, MAX_QUESTIONS_OFFSET);

  // Each optional narrowing is added only when the caller asked for it, so the
  // WHERE carries exactly the constraints this query means to apply.
  const where: Prisma.QuestionWhereInput = { courseId };
  if (!includeDeleted) where.deletedAt = null;
  if (topicId !== undefined) where.topicId = topicId;
  if (testable !== undefined) where.testable = testable;

  const [questions, total] = await Promise.all([
    prisma.question.findMany({
      where,
      include: { secondaryTopics: true },
      orderBy: { createdAt: "desc" },
      take: safeLimit,
      skip: safeOffset,
    }),
    prisma.question.count({ where }),
  ]);

  return { questions, total, limit: safeLimit, offset: safeOffset };
}

export async function getQuestionById(id: string, includeDeleted = false) {
  return prisma.question.findFirst({
    where: { id, deletedAt: includeDeleted ? undefined : null },
    include: { secondaryTopics: true },
  });
}

export async function updateQuestionTestable(id: string, testable: boolean) {
  try {
    return await prisma.question.update({
      where: { id, deletedAt: null },
      data: { testable },
      select: { id: true, testable: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return null;
    }
    throw err;
  }
}
