import { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { validateCreateQuestion } from "~/lib/questions/schema";

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

/**
 * Validates the POST /api/questions body. Rejects malformed payloads and
 * out-of-range enums with a 422 VALIDATION_ERROR instead of letting an invalid
 * value reach Prisma and surface as a 500.
 *
 * Cross-field rules for select-all-that-apply mirror QM `normalizeMcqCorrectness`:
 * multi requires MCQ + non-empty letter-only `correctAnswers` present in `choices`;
 * single mode rejects a populated `correctAnswers`; `answer` is derived from the
 * first sorted correct letter when multi is on.
 */
const CreateQuestionSchema = z
  .object({
    courseId: z.string().min(1),
    topicId: z.string().min(1),
    content: z.string().min(1),
    type: z.enum(["MCQ", "SA", "LA"]),
    difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).optional(),
    reasoningLevel: z.enum(["FACTUAL", "ANALYTICAL", "APPLICATION"]).optional(),
    choices: z.array(z.object({ letter: z.string().min(1), text: z.string().min(1) })).optional(),
    answer: z.string().optional(),
    selectAllThatApply: z.boolean().optional(),
    correctAnswers: z.array(z.string().min(1)).nullable().optional(),
    testable: z.boolean().optional(),
    secondaryTopicIds: z.array(z.string().min(1)).optional(),
  })
  .superRefine((data, ctx) => {
    const selectAll = data.selectAllThatApply === true;
    const answers = data.correctAnswers;

    if (!selectAll) {
      if (answers != null && Array.isArray(answers) && answers.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "correctAnswers is only allowed when selectAllThatApply is true",
          path: ["correctAnswers"],
        });
      }
      return;
    }

    if (data.type !== "MCQ") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "selectAllThatApply is only valid for MCQ questions",
        path: ["selectAllThatApply"],
      });
    }

    if (!Array.isArray(answers) || answers.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "selectAllThatApply requires at least one correctAnswers entry",
        path: ["correctAnswers"],
      });
      return;
    }

    const choiceLetters = new Set(
      (data.choices ?? []).map((c) => c.letter.trim().toUpperCase()).filter(Boolean),
    );
    for (const raw of answers) {
      const letter = String(raw).trim();
      if (!/^[A-Za-z]$/.test(letter)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "correctAnswers entries must be single letters",
          path: ["correctAnswers"],
        });
        return;
      }
      if (!choiceLetters.has(letter.toUpperCase())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Correct answer ${letter.toUpperCase()} is not in choices`,
          path: ["correctAnswers"],
        });
        return;
      }
    }
  })
  .transform((data) => {
    const selectAllThatApply = data.selectAllThatApply === true;
    if (!selectAllThatApply) {
      return {
        ...data,
        selectAllThatApply: false,
        correctAnswers: null as string[] | null,
      };
    }
    const unique = [
      ...new Set(
        (data.correctAnswers ?? []).map((a) => String(a).trim().toUpperCase()).filter(Boolean),
      ),
    ].sort();
    return {
      ...data,
      selectAllThatApply: true,
      correctAnswers: unique,
      answer: unique[0],
    };
  });
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
  body: unknown,
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
  if (
    !primaryTopic
    || primaryTopic.deletedAt !== null
    || primaryTopic.courseId !== courseId
  ) {
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
      return { error: "INVALID_TOPIC_IDS", deletedTopicIds: invalidTopicIds, conflictingWithPrimary: [] };
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
      take: safeLimit,
      skip: safeOffset,
    }),
    prisma.question.count({ where }),
  ]);

  return { questions, total, limit: safeLimit, offset: safeOffset };
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
