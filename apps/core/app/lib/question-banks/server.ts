import { Prisma } from "@prisma/client";

import prisma from "~/lib/prisma.server";
import {
  AddBankMembershipSchema,
  AddBankMembershipsSchema,
  CreateQuestionBankSchema,
  DeleteQuestionBankSchema,
  MoveBankMembershipSchema,
  UpdateQuestionBankSchema,
  type AddBankMembershipInput,
  type AddBankMembershipsInput,
  type CreateQuestionBankInput,
  type DeleteQuestionBankInput,
  type MoveBankMembershipInput,
  type UpdateQuestionBankInput,
} from "./schemas";

export const DEFAULT_BANK_NAME = "Course bank";

type DbClient = typeof prisma | Prisma.TransactionClient;

function isUniqueViolation(cause: unknown): boolean {
  return cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002";
}

export async function ensureDefaultBank(courseId: string, db: DbClient = prisma) {
  const existing = await db.questionBank.findFirst({
    where: { courseId, isDefault: true },
  });
  if (existing) return existing;

  try {
    return await db.questionBank.create({
      data: {
        courseId,
        name: DEFAULT_BANK_NAME,
        isDefault: true,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // PostgreSQL aborts an interactive transaction after P2002. Let the
      // Canvas sync boundary retry with a fresh transaction instead of querying
      // through the dead one.
      if (db !== prisma) throw error;
      const raced = await db.questionBank.findFirst({
        where: { courseId, isDefault: true },
      });
      if (raced) return raced;
    }
    throw error;
  }
}

/** Read-only list — does not create a default bank (mutations / course create do). */
export async function listQuestionBanks(courseId: string) {
  return prisma.questionBank.findMany({
    where: { courseId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

export async function createQuestionBank(courseId: string, payload: CreateQuestionBankInput) {
  const parsed = CreateQuestionBankSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "Invalid input", details: parsed.error.flatten() } as const;
  }

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) {
    return { error: "Course not found" } as const;
  }

  await ensureDefaultBank(courseId);

  const bank = await prisma.questionBank.create({
    data: {
      courseId,
      name: parsed.data.name.trim(),
      description: parsed.data.description ?? null,
      isDefault: false,
    },
  });

  return { bank } as const;
}

export async function updateQuestionBank(
  courseId: string,
  bankId: string,
  payload: UpdateQuestionBankInput,
) {
  const parsed = UpdateQuestionBankSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "Invalid input", details: parsed.error.flatten() } as const;
  }

  const bank = await prisma.questionBank.findFirst({
    where: { id: bankId, courseId },
  });
  if (!bank) {
    return { error: "Question bank not found" } as const;
  }

  const updated = await prisma.questionBank.update({
    where: { id: bankId },
    // Prisma leaves a column untouched when its update value is `undefined`,
    // so a partial payload only writes the fields the caller actually sent.
    data: {
      name: parsed.data.name !== undefined ? parsed.data.name.trim() : undefined,
      description: parsed.data.description,
    },
  });

  return { bank: updated } as const;
}

export async function deleteQuestionBank(
  courseId: string,
  bankId: string,
  payload: DeleteQuestionBankInput = {},
) {
  const parsed = DeleteQuestionBankSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "Invalid input", details: parsed.error.flatten() } as const;
  }

  const bank = await prisma.questionBank.findFirst({
    where: { id: bankId, courseId },
  });
  if (!bank) {
    return { error: "Question bank not found" } as const;
  }
  if (bank.isDefault) {
    return { error: "Cannot delete the default question bank" } as const;
  }

  const membershipCount = await prisma.questionBankMembership.count({
    where: { questionBankId: bankId },
  });

  if (membershipCount > 0) {
    const moveTo = parsed.data.moveMembershipsToBankId;
    if (!moveTo) {
      return {
        error: "Bank has questions; provide moveMembershipsToBankId to reassign memberships",
      } as const;
    }
    const target = await prisma.questionBank.findFirst({
      where: { id: moveTo, courseId },
    });
    if (!target || target.id === bank.id) {
      return { error: "Target bank not found in this course" } as const;
    }

    const memberships = await prisma.questionBankMembership.findMany({
      where: { questionBankId: bankId },
    });

    await prisma.$transaction(async (tx) => {
      if (memberships.length > 0) {
        await tx.questionBankMembership.createMany({
          data: memberships.map((membership) => ({
            questionBankId: target.id,
            source: membership.source,
            externalQuestionId: membership.externalQuestionId,
          })),
          skipDuplicates: true,
        });
        await tx.questionBankMembership.deleteMany({
          where: { questionBankId: bankId },
        });
      }
      await tx.questionBank.delete({ where: { id: bankId } });
    });

    return { success: true } as const;
  }

  await prisma.questionBank.delete({ where: { id: bankId } });
  return { success: true } as const;
}

/**
 * Membership is a set, not a list: a bank holds a question once or not at all.
 * Adding or moving into a bank that already holds it is a conflict rather than a
 * silent no-op, so the caller can say so instead of reporting a successful add
 * (and, for a move, instead of quietly degrading into a removal from the source).
 */
const DUPLICATE_MEMBERSHIP_ERROR = "Question is already in this bank";
const DUPLICATE_TARGET_MEMBERSHIP_ERROR = "Question is already in the target bank";

export async function addQuestionToBank(
  courseId: string,
  bankId: string,
  payload: AddBankMembershipInput,
) {
  const parsed = AddBankMembershipSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "Invalid input", details: parsed.error.flatten() } as const;
  }

  const bank = await prisma.questionBank.findFirst({
    where: { id: bankId, courseId },
  });
  if (!bank) {
    return { error: "Question bank not found" } as const;
  }

  const existing = await prisma.questionBankMembership.findUnique({
    where: {
      questionBankId_source_externalQuestionId: {
        questionBankId: bankId,
        source: parsed.data.source,
        externalQuestionId: parsed.data.externalQuestionId,
      },
    },
  });
  if (existing) {
    return { error: DUPLICATE_MEMBERSHIP_ERROR } as const;
  }

  try {
    const membership = await prisma.questionBankMembership.create({
      data: {
        questionBankId: bankId,
        source: parsed.data.source,
        externalQuestionId: parsed.data.externalQuestionId,
      },
    });
    return { membership } as const;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: DUPLICATE_MEMBERSHIP_ERROR } as const;
    }
    throw error;
  }
}

/** Bulk membership upsert — collapses N Core round-trips for Canvas bank import. */
export async function addQuestionsToBank(
  courseId: string,
  bankId: string,
  payload: AddBankMembershipsInput,
) {
  const parsed = AddBankMembershipsSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "Invalid input", details: parsed.error.flatten() } as const;
  }

  const bank = await prisma.questionBank.findFirst({
    where: { id: bankId, courseId },
  });
  if (!bank) {
    return { error: "Question bank not found" } as const;
  }

  await prisma.questionBankMembership.createMany({
    data: parsed.data.memberships.map((m) => ({
      questionBankId: bankId,
      source: m.source,
      externalQuestionId: m.externalQuestionId,
    })),
    skipDuplicates: true,
  });

  const memberships = await prisma.questionBankMembership.findMany({
    where: {
      questionBankId: bankId,
      OR: parsed.data.memberships.map((m) => ({
        source: m.source,
        externalQuestionId: m.externalQuestionId,
      })),
    },
  });

  return { memberships, added: memberships.length } as const;
}

export async function removeQuestionFromBank(
  courseId: string,
  bankId: string,
  externalQuestionId: string,
  source = "question-maker",
) {
  const bank = await prisma.questionBank.findFirst({
    where: { id: bankId, courseId },
  });
  if (!bank) {
    return { error: "Question bank not found" } as const;
  }

  const membership = await prisma.questionBankMembership.findUnique({
    where: {
      questionBankId_source_externalQuestionId: {
        questionBankId: bankId,
        source,
        externalQuestionId,
      },
    },
  });
  if (!membership) {
    return { error: "Question is not a member of this bank" } as const;
  }

  await prisma.questionBankMembership.delete({ where: { id: membership.id } });

  const remaining = await prisma.questionBankMembership.count({
    where: {
      source,
      externalQuestionId,
      questionBank: { courseId },
    },
  });

  if (remaining === 0) {
    const defaultBank = await ensureDefaultBank(courseId);
    await prisma.questionBankMembership.create({
      data: {
        questionBankId: defaultBank.id,
        source,
        externalQuestionId,
      },
    });
    return {
      removed: true,
      reassignedToDefault: true,
      defaultBankId: defaultBank.id,
    } as const;
  }

  return { removed: true, reassignedToDefault: false } as const;
}

/**
 * Moves one question's membership from `fromBankId` to `targetBankId` atomically.
 * The question always ends up in the target, so unlike `removeQuestionFromBank`
 * there is no orphan → default-bank reassignment.
 */
export async function moveQuestionBetweenBanks(
  courseId: string,
  fromBankId: string,
  externalQuestionId: string,
  payload: MoveBankMembershipInput,
) {
  const parsed = MoveBankMembershipSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: "Invalid input", details: parsed.error.flatten() } as const;
  }
  const { targetBankId, source } = parsed.data;
  if (targetBankId === fromBankId) {
    return { error: "Source and target bank must differ" } as const;
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const banks = await tx.questionBank.findMany({
        where: { id: { in: [fromBankId, targetBankId] }, courseId },
        select: { id: true },
      });
      if (banks.length !== 2) {
        return { error: "Question bank not found" } as const;
      }

      const current = await tx.questionBankMembership.findUnique({
        where: {
          questionBankId_source_externalQuestionId: {
            questionBankId: fromBankId,
            source,
            externalQuestionId,
          },
        },
      });
      if (!current) {
        return { error: "Question is not a member of this bank" } as const;
      }

      const alreadyInTarget = await tx.questionBankMembership.findUnique({
        where: {
          questionBankId_source_externalQuestionId: {
            questionBankId: targetBankId,
            source,
            externalQuestionId,
          },
        },
      });
      if (alreadyInTarget) {
        return { error: DUPLICATE_TARGET_MEMBERSHIP_ERROR } as const;
      }

      const membership = await tx.questionBankMembership.create({
        data: { questionBankId: targetBankId, source, externalQuestionId },
      });
      await tx.questionBankMembership.delete({ where: { id: current.id } });

      return { membership } as const;
    });
  } catch (error) {
    // A concurrent add can win between the pre-check and the insert. Catching P2002
    // outside the transaction keeps the rollback intact, so the question stays in the
    // source bank instead of being dropped on the way to a target that already has it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: DUPLICATE_TARGET_MEMBERSHIP_ERROR } as const;
    }
    throw error;
  }
}

export async function listBankMemberships(courseId: string, bankId: string) {
  const bank = await prisma.questionBank.findFirst({
    where: { id: bankId, courseId },
  });
  if (!bank) {
    return { error: "Question bank not found" } as const;
  }

  const memberships = await prisma.questionBankMembership.findMany({
    where: { questionBankId: bankId },
    orderBy: { createdAt: "asc" },
  });
  return { memberships } as const;
}

export async function listMembershipsForQuestion(
  courseId: string,
  externalQuestionId: string,
  source = "question-maker",
) {
  return prisma.questionBankMembership.findMany({
    where: {
      source,
      externalQuestionId,
      questionBank: { courseId },
    },
    include: { questionBank: true },
  });
}
