import { Prisma } from "@prisma/client";
import { z } from "zod";
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
};

/**
 * Validates the POST /api/questions body. Rejects malformed payloads and
 * out-of-range enums with a 422 VALIDATION_ERROR instead of letting an invalid
 * value reach Prisma and surface as a 500.
 */
const CreateQuestionSchema = z.object({
  courseId: z.string().min(1),
  topicId: z.string().min(1),
  content: z.string().min(1),
  type: z.enum(["MCQ", "SA", "LA"]),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).optional(),
  reasoningLevel: z.enum(["FACTUAL", "ANALYTICAL", "APPLICATION"]).optional(),
  choices: z.array(z.object({ letter: z.string().min(1), text: z.string().min(1) })).optional(),
  answer: z.string().optional(),
  testable: z.boolean().optional(),
  secondaryTopicIds: z.array(z.string().min(1)).optional(),
});

type CreateQuestionError =
  | { error: "VALIDATION_ERROR"; fields: Record<string, string> }
  | { error: "COURSE_NOT_FOUND" }
  | { error: "TOPIC_NOT_FOUND" }
  | { error: "DUPLICATE_TOPIC"; conflictingIds: string[] }
  | { error: "INVALID_TOPIC_IDS"; deletedTopicIds: string[]; conflictingWithPrimary: string[] };

type CreateQuestionSuccess = { id: string };

export async function createQuestion(
  body: unknown,
  createdBy: string
): Promise<CreateQuestionError | CreateQuestionSuccess> {
  const parsed = CreateQuestionSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const fields: Record<string, string> = {};
    for (const [key, messages] of Object.entries(fieldErrors)) {
      if (messages && messages.length > 0) fields[key] = messages[0];
    }
    return { error: "VALIDATION_ERROR", fields };
  }

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
  } = parsed.data;

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
    const foundIds = new Set(secondaryTopics.map((t) => t.id));
    const deletedTopicIds = secondaryTopics
      .filter((t) => t.deletedAt !== null)
      .map((t) => t.id);
    // Genuinely-absent IDs would otherwise slip past this check and trigger an
    // FK violation (P2003) → 500 when writing question_secondary_topics. Fold
    // them in with the soft-deleted ones: both are invalid Core references and
    // QM's remediation (null its core_topic_id) is identical for either case.
    const missingTopicIds = [...new Set(secondaryTopicIds)].filter((id) => !foundIds.has(id));
    const invalidTopicIds = [...deletedTopicIds, ...missingTopicIds];
    if (invalidTopicIds.length > 0) {
      return { error: "INVALID_TOPIC_IDS", deletedTopicIds: invalidTopicIds, conflictingWithPrimary: [] };
    }
  }

  try {
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
  } catch (err) {
    throw err;
  }
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
  const clampedLimit = Math.min(limit, 500);

  const where: Prisma.QuestionWhereInput = {
    courseId,
    ...(includeDeleted ? {} : { deletedAt: null }),
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

export async function getQuestionById(id: string, includeDeleted = false) {
  return prisma.question.findFirst({
    where: { id, ...(includeDeleted ? {} : { deletedAt: null }) },
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
