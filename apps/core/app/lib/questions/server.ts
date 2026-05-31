import { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";

export type CreateQuestionBody = {
  courseId: string;
  topicId: string;
  content: string;
  type: "MCQ" | "SA" | "LA";
  difficulty?: "EASY" | "MEDIUM" | "HARD";
  reasoningLevel?: "FACTUAL" | "ANALYTICAL" | "APPLICATION";
  choices?: { letter: string; text: string }[];
  answer?: string;
  testable?: boolean;
  secondaryTopicIds?: string[];
  idempotencyKey?: string;
};

type CreateQuestionError =
  | { error: "COURSE_NOT_FOUND" }
  | { error: "TOPIC_NOT_FOUND" }
  | { error: "DUPLICATE_TOPIC"; conflictingIds: string[] }
  | { error: "INVALID_TOPIC_IDS"; deletedTopicIds: string[]; conflictingWithPrimary: string[] };

type CreateQuestionSuccess = { id: string };

export async function createQuestion(
  body: CreateQuestionBody,
  createdBy: string
): Promise<CreateQuestionError | CreateQuestionSuccess> {
  const {
    courseId,
    topicId,
    content,
    type,
    difficulty = "MEDIUM",
    reasoningLevel = "FACTUAL",
    choices,
    answer,
    testable = false,
    secondaryTopicIds = [],
    idempotencyKey,
  } = body;

  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
  if (!course) return { error: "COURSE_NOT_FOUND" };

  const primaryTopic = await prisma.courseTopic.findUnique({
    where: { id: topicId },
    select: { id: true, deletedAt: true },
  });
  if (!primaryTopic || primaryTopic.deletedAt !== null) return { error: "TOPIC_NOT_FOUND" };

  if (secondaryTopicIds.includes(topicId)) {
    return { error: "DUPLICATE_TOPIC", conflictingIds: [topicId] };
  }

  if (secondaryTopicIds.length > 0) {
    const secondaryTopics = await prisma.courseTopic.findMany({
      where: { id: { in: secondaryTopicIds } },
      select: { id: true, deletedAt: true },
    });
    const deletedTopicIds = secondaryTopics
      .filter((t) => t.deletedAt !== null)
      .map((t) => t.id);
    if (deletedTopicIds.length > 0) {
      return { error: "INVALID_TOPIC_IDS", deletedTopicIds, conflictingWithPrimary: [] };
    }
  }

  if (idempotencyKey) {
    const existing = await prisma.question.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });
    if (existing) return { id: existing.id };
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
        testable,
        idempotencyKey,
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
};

export async function listQuestions(params: ListQuestionsParams) {
  const { courseId, topicId, testable, limit = 100, offset = 0 } = params;
  const clampedLimit = Math.min(limit, 500);

  const where: Prisma.QuestionWhereInput = {
    courseId,
    deletedAt: null,
    ...(topicId !== undefined && { topicId }),
    ...(testable !== undefined && { testable }),
  };

  const [questions, total] = await Promise.all([
    prisma.question.findMany({
      where,
      include: { secondaryTopics: true },
      orderBy: { createdAt: "desc" },
      take: clampedLimit,
      skip: offset,
    }),
    prisma.question.count({ where }),
  ]);

  return { questions, total, limit: clampedLimit, offset };
}

export async function getQuestionById(id: string) {
  return prisma.question.findFirst({
    where: { id, deletedAt: null },
    include: { secondaryTopics: true },
  });
}

export async function updateQuestionTestable(id: string, testable: boolean) {
  try {
    return await prisma.question.update({
      where: { id },
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
