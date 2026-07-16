import prisma from "~/lib/prisma.server";
import {
  AddBankMembershipSchema,
  CreateQuestionBankSchema,
  DeleteQuestionBankSchema,
  UpdateQuestionBankSchema,
  type AddBankMembershipInput,
  type CreateQuestionBankInput,
  type DeleteQuestionBankInput,
  type UpdateQuestionBankInput,
} from "./schemas";

export const DEFAULT_BANK_NAME = "Course bank";

export async function ensureDefaultBank(courseId: string) {
  const existing = await prisma.questionBank.findFirst({
    where: { courseId, isDefault: true },
  });
  if (existing) return existing;

  return prisma.questionBank.create({
    data: {
      courseId,
      name: DEFAULT_BANK_NAME,
      isDefault: true,
    },
  });
}

export async function listQuestionBanks(courseId: string) {
  await ensureDefaultBank(courseId);
  return prisma.questionBank.findMany({
    where: { courseId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
}

export async function createQuestionBank(
  courseId: string,
  payload: CreateQuestionBankInput,
) {
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
    data: {
      ...(parsed.data.name !== undefined
        ? { name: parsed.data.name.trim() }
        : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description }
        : {}),
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
        error:
          "Bank has questions; provide moveMembershipsToBankId to reassign memberships",
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
    for (const membership of memberships) {
      await prisma.questionBankMembership.upsert({
        where: {
          questionBankId_source_externalQuestionId: {
            questionBankId: target.id,
            source: membership.source,
            externalQuestionId: membership.externalQuestionId,
          },
        },
        create: {
          questionBankId: target.id,
          source: membership.source,
          externalQuestionId: membership.externalQuestionId,
        },
        update: {},
      });
    }
    await prisma.questionBankMembership.deleteMany({
      where: { questionBankId: bankId },
    });
  }

  await prisma.questionBank.delete({ where: { id: bankId } });
  return { success: true } as const;
}

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

  const membership = await prisma.questionBankMembership.upsert({
    where: {
      questionBankId_source_externalQuestionId: {
        questionBankId: bankId,
        source: parsed.data.source,
        externalQuestionId: parsed.data.externalQuestionId,
      },
    },
    create: {
      questionBankId: bankId,
      source: parsed.data.source,
      externalQuestionId: parsed.data.externalQuestionId,
    },
    update: {},
  });

  return { membership } as const;
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
    where: { source, externalQuestionId },
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
