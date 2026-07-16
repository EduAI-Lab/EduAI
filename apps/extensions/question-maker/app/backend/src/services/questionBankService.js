/**
 * Question bank CRUD, default-bank ensure/backfill, and multi-bank membership helpers.
 */
import {
  Course,
  QuestionBank,
  QuestionBankMembership,
  Question_Metadata
} from '../schema/index.js';

export const DEFAULT_BANK_NAME = 'Course bank';

/**
 * Returns the default bank for a course, creating one if missing.
 * @param {number} courseId
 * @param {{ transaction?: import('sequelize').Transaction }} [options]
 */
export async function ensureDefaultBank(courseId, options = {}) {
  const { transaction } = options;
  let bank = await QuestionBank.findOne({
    where: { courseId, isDefault: true },
    transaction
  });
  if (bank) {
    return bank;
  }
  bank = await QuestionBank.create(
    {
      courseId,
      name: DEFAULT_BANK_NAME,
      isDefault: true
    },
    { transaction }
  );
  return bank;
}

/**
 * Idempotent backfill: ensure every course has a default bank and every question
 * has at least one membership (on that course's default bank).
 * @returns {Promise<{ coursesProcessed: number, banksCreated: number, membershipsCreated: number }>}
 */
export async function backfillDefaultBanks() {
  const courses = await Course.findAll({ attributes: ['id'] });
  let banksCreated = 0;
  let membershipsCreated = 0;

  for (const course of courses) {
    const existingDefault = await QuestionBank.findOne({
      where: { courseId: course.id, isDefault: true }
    });
    if (!existingDefault) {
      banksCreated += 1;
    }
    const defaultBank = await ensureDefaultBank(course.id);

    const questions = await Question_Metadata.findAll({
      where: { courseId: course.id },
      attributes: ['id'],
      include: [
        {
          model: QuestionBankMembership,
          as: 'bankMemberships',
          required: false,
          attributes: ['id']
        }
      ]
    });

    for (const question of questions) {
      const memberships = question.bankMemberships || [];
      if (memberships.length === 0) {
        await QuestionBankMembership.findOrCreate({
          where: {
            questionBankId: defaultBank.id,
            questionMetadataId: question.id
          },
          defaults: {
            questionBankId: defaultBank.id,
            questionMetadataId: question.id
          }
        });
        membershipsCreated += 1;
      }
    }
  }

  return {
    coursesProcessed: courses.length,
    banksCreated,
    membershipsCreated
  };
}

/**
 * Lists banks for a course (caller must verify ownership).
 * @param {number} courseId
 */
export async function listBanks(courseId) {
  return QuestionBank.findAll({
    where: { courseId },
    order: [
      ['isDefault', 'DESC'],
      ['createdAt', 'ASC']
    ]
  });
}

/**
 * Creates a non-default bank on a course.
 * @param {number} courseId
 * @param {{ name: string, description?: string|null }} payload
 */
export async function createBank(courseId, { name, description = null }) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) {
    const err = new Error('Bank name is required');
    err.status = 400;
    throw err;
  }
  return QuestionBank.create({
    courseId,
    name: trimmed,
    description: description ?? null,
    isDefault: false
  });
}

/**
 * Updates bank name/description. Rejects clearing default flag via this path.
 * @param {number} courseId
 * @param {number} bankId
 * @param {{ name?: string, description?: string|null }} payload
 */
export async function updateBank(courseId, bankId, payload) {
  const bank = await QuestionBank.findOne({ where: { id: bankId, courseId } });
  if (!bank) {
    const err = new Error('Question bank not found');
    err.status = 404;
    throw err;
  }
  const updates = {};
  if (payload.name !== undefined) {
    const trimmed = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!trimmed) {
      const err = new Error('Bank name is required');
      err.status = 400;
      throw err;
    }
    updates.name = trimmed;
  }
  if (payload.description !== undefined) {
    updates.description = payload.description;
  }
  await bank.update(updates);
  return bank;
}

/**
 * Deletes a non-default bank. Moves memberships when moveMembershipsToBankId is set,
 * or requires the bank to be empty.
 * @param {number} courseId
 * @param {number} bankId
 * @param {{ moveMembershipsToBankId?: number }} [options]
 */
export async function deleteBank(courseId, bankId, options = {}) {
  const bank = await QuestionBank.findOne({ where: { id: bankId, courseId } });
  if (!bank) {
    const err = new Error('Question bank not found');
    err.status = 404;
    throw err;
  }
  if (bank.isDefault) {
    const err = new Error('Cannot delete the default question bank');
    err.status = 400;
    throw err;
  }

  const membershipCount = await QuestionBankMembership.count({
    where: { questionBankId: bankId }
  });

  if (membershipCount > 0) {
    const moveTo = options.moveMembershipsToBankId;
    if (!moveTo) {
      const err = new Error(
        'Bank has questions; provide moveMembershipsToBankId to reassign memberships'
      );
      err.status = 400;
      throw err;
    }
    const target = await QuestionBank.findOne({
      where: { id: moveTo, courseId }
    });
    if (!target) {
      const err = new Error('Target bank not found in this course');
      err.status = 400;
      throw err;
    }
    if (target.id === bank.id) {
      const err = new Error('moveMembershipsToBankId must differ from the bank being deleted');
      err.status = 400;
      throw err;
    }

    const memberships = await QuestionBankMembership.findAll({
      where: { questionBankId: bankId }
    });
    for (const membership of memberships) {
      await QuestionBankMembership.findOrCreate({
        where: {
          questionBankId: target.id,
          questionMetadataId: membership.questionMetadataId
        },
        defaults: {
          questionBankId: target.id,
          questionMetadataId: membership.questionMetadataId
        }
      });
      await membership.destroy();
    }
  }

  await bank.destroy();
  return { deleted: true };
}

/**
 * Ensures a question is a member of a bank (same course). Idempotent.
 * @param {number} questionBankId
 * @param {number} questionMetadataId
 */
export async function addQuestionToBank(questionBankId, questionMetadataId) {
  const bank = await QuestionBank.findByPk(questionBankId);
  if (!bank) {
    const err = new Error('Question bank not found');
    err.status = 404;
    throw err;
  }
  const question = await Question_Metadata.findByPk(questionMetadataId);
  if (!question) {
    const err = new Error('Question not found');
    err.status = 404;
    throw err;
  }
  if (question.courseId !== bank.courseId) {
    const err = new Error('Question and bank must belong to the same course');
    err.status = 400;
    throw err;
  }

  const [membership, created] = await QuestionBankMembership.findOrCreate({
    where: { questionBankId, questionMetadataId },
    defaults: { questionBankId, questionMetadataId }
  });
  return { membership, created };
}

/**
 * Removes membership from a bank. If it was the last membership, reassigns to the default bank.
 * @param {number} courseId
 * @param {number} questionBankId
 * @param {number} questionMetadataId
 */
export async function removeQuestionFromBank(courseId, questionBankId, questionMetadataId) {
  const bank = await QuestionBank.findOne({ where: { id: questionBankId, courseId } });
  if (!bank) {
    const err = new Error('Question bank not found');
    err.status = 404;
    throw err;
  }

  const membership = await QuestionBankMembership.findOne({
    where: { questionBankId, questionMetadataId }
  });
  if (!membership) {
    const err = new Error('Question is not a member of this bank');
    err.status = 404;
    throw err;
  }

  await membership.destroy();

  const remaining = await QuestionBankMembership.count({
    where: { questionMetadataId }
  });
  if (remaining === 0) {
    const defaultBank = await ensureDefaultBank(courseId);
    await QuestionBankMembership.create({
      questionBankId: defaultBank.id,
      questionMetadataId
    });
    return { removed: true, reassignedToDefault: true, defaultBankId: defaultBank.id };
  }

  return { removed: true, reassignedToDefault: false };
}

/**
 * Attach a newly created question to one or more banks (default bank if none given).
 * @param {number} courseId
 * @param {number} questionMetadataId
 * @param {{ questionBankId?: number, questionBankIds?: number[] }} [opts]
 */
export async function attachQuestionToBanks(courseId, questionMetadataId, opts = {}) {
  let bankIds = [];
  if (Array.isArray(opts.questionBankIds) && opts.questionBankIds.length > 0) {
    bankIds = opts.questionBankIds.map(Number).filter((id) => Number.isInteger(id));
  } else if (opts.questionBankId != null) {
    bankIds = [Number(opts.questionBankId)];
  }

  if (bankIds.length === 0) {
    const defaultBank = await ensureDefaultBank(courseId);
    bankIds = [defaultBank.id];
  }

  for (const bankId of bankIds) {
    const bank = await QuestionBank.findOne({ where: { id: bankId, courseId } });
    if (!bank) {
      const err = new Error('Question bank not found for this course');
      err.status = 400;
      throw err;
    }
    await addQuestionToBank(bankId, questionMetadataId);
  }

  return bankIds;
}
