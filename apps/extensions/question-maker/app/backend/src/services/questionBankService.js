/**
 * Question bank operations proxied to EduAI Core.
 * Local QM courses resolve to Core via `Course.coreCourseId` or course code match.
 * Membership uses Core Question ids (`Variants.coreQuestionId`).
 */
import { Op } from 'sequelize';
import {
  Course,
  Question_Metadata,
  Variants,
  CanvasBankQuestionMapping
} from '../schema/index.js';
import eduaiService from './eduaiService.js';

export const DEFAULT_BANK_NAME = 'Course bank';

const normalizeCode = (value) =>
  value == null ? '' : String(value).replace(/\s+/g, '').toLowerCase();

function coreError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function callCore(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error.status) throw error;
    const status = error.response?.status || 502;
    const message =
      error.response?.data?.error ||
      error.response?.data?.message ||
      error.message ||
      'EduAI Core request failed';
    throw coreError(message, status);
  }
}

/**
 * Resolve a local QM course to a Core course CUID.
 * Prefers `Course.coreCourseId`; falls back to matching course code via Core list.
 * @param {number} localCourseId
 * @param {number} userId
 * @returns {Promise<{ localCourse: object, coreCourseId: string }>}
 */
export async function resolveCoreCourse(localCourseId, userId) {
  const localCourse = await Course.findOne({
    where: { id: localCourseId, userId }
  });
  if (!localCourse) {
    throw coreError('Course not found', 404);
  }

  if (localCourse.coreCourseId?.trim()) {
    return { localCourse, coreCourseId: String(localCourse.coreCourseId).trim() };
  }

  if (!localCourse.code?.trim()) {
    throw coreError(
      'Course code is required to sync question banks with EduAI Core',
      400
    );
  }

  if (!eduaiService.isConfigured()) {
    throw coreError(
      'EduAI Core is not configured. Set EDUAI_API_URL and EDUAI_API_KEY.',
      503
    );
  }

  const listed = await callCore(() => eduaiService.listCourses());
  const courses = Array.isArray(listed)
    ? listed
    : Array.isArray(listed?.courses)
      ? listed.courses
      : [];
  const match = courses.find(
    (c) => normalizeCode(c.code) === normalizeCode(localCourse.code)
  );
  if (!match?.id) {
    throw coreError(
      `No EduAI Core course found with code "${localCourse.code}"`,
      404
    );
  }

  return { localCourse, coreCourseId: String(match.id) };
}

/** Map Core bank JSON to the shape the QM frontend expects. */
function mapBank(bank, localCourseId) {
  return {
    id: bank.id,
    courseId: localCourseId,
    name: bank.name,
    description: bank.description ?? null,
    isDefault: Boolean(bank.isDefault),
    createdAt: bank.createdAt,
    updatedAt: bank.updatedAt
  };
}

export async function ensureDefaultBank(localCourseId, userId) {
  const { coreCourseId } = await resolveCoreCourse(localCourseId, userId);
  const banks = await callCore(() =>
    eduaiService.listQuestionBanks(coreCourseId)
  );
  const list = Array.isArray(banks?.banks) ? banks.banks : [];
  let defaultBank = list.find((b) => b.isDefault);
  if (!defaultBank) {
    // Core listQuestionBanks already ensures default; refetch
    const again = await callCore(() =>
      eduaiService.listQuestionBanks(coreCourseId)
    );
    defaultBank =
      (again?.banks || []).find((b) => b.isDefault) || again?.banks?.[0];
  }
  if (!defaultBank) {
    throw coreError('Failed to ensure default question bank in Core', 500);
  }
  return mapBank(defaultBank, localCourseId);
}

export async function listBanks(localCourseId, userId) {
  const { coreCourseId } = await resolveCoreCourse(localCourseId, userId);
  const payload = await callCore(() =>
    eduaiService.listQuestionBanks(coreCourseId)
  );
  const banks = Array.isArray(payload?.banks) ? payload.banks : [];
  return banks.map((b) => mapBank(b, localCourseId));
}

export async function createBank(localCourseId, userId, { name, description = null }) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) {
    throw coreError('Bank name is required', 400);
  }
  const { coreCourseId } = await resolveCoreCourse(localCourseId, userId);
  const bank = await callCore(() =>
    eduaiService.createQuestionBank(coreCourseId, {
      name: trimmed,
      description
    })
  );
  return mapBank(bank, localCourseId);
}

export async function updateBank(localCourseId, userId, bankId, payload) {
  const { coreCourseId } = await resolveCoreCourse(localCourseId, userId);
  const bank = await callCore(() =>
    eduaiService.updateQuestionBank(coreCourseId, bankId, payload)
  );
  return mapBank(bank, localCourseId);
}

export async function deleteBank(localCourseId, userId, bankId, options = {}) {
  const { coreCourseId } = await resolveCoreCourse(localCourseId, userId);
  return callCore(() =>
    eduaiService.deleteQuestionBank(coreCourseId, bankId, {
      moveMembershipsToBankId: options.moveMembershipsToBankId
    })
  );
}

async function findApprovedCoreQuestionId(questionMetadataId) {
  const variant = await Variants.findOne({
    where: { questionMetadataId, coreQuestionId: { [Op.ne]: null } },
    order: [['updatedAt', 'DESC']]
  });
  return variant?.coreQuestionId ?? null;
}

export async function addQuestionToBank(localCourseId, userId, bankId, questionMetadataId) {
  const question = await Question_Metadata.findByPk(questionMetadataId);
  if (!question) {
    throw coreError('Question not found', 404);
  }
  if (Number(question.courseId) !== Number(localCourseId)) {
    throw coreError('Question and bank must belong to the same course', 400);
  }

  const coreQuestionId = await findApprovedCoreQuestionId(questionMetadataId);
  if (!coreQuestionId) {
    throw coreError(
      'Approve the question (push to Core) before adding it to a bank',
      409
    );
  }

  const { coreCourseId } = await resolveCoreCourse(localCourseId, userId);
  const membership = await callCore(() =>
    eduaiService.addQuestionBankMembership(coreCourseId, bankId, {
      questionId: coreQuestionId
    })
  );
  return { membership, created: true };
}

export async function removeQuestionFromBank(
  localCourseId,
  userId,
  bankId,
  questionMetadataId
) {
  const coreQuestionId = await findApprovedCoreQuestionId(questionMetadataId);
  if (!coreQuestionId) {
    throw coreError(
      'Approve the question (push to Core) before removing it from a bank',
      409
    );
  }

  const { coreCourseId } = await resolveCoreCourse(localCourseId, userId);
  return callCore(() =>
    eduaiService.removeQuestionBankMembership(
      coreCourseId,
      bankId,
      coreQuestionId
    )
  );
}

/**
 * Attach a newly created local question to one or more Core banks.
 * Skips banks when the question has not been pushed to Core yet (409).
 */
export async function attachQuestionToBanks(
  localCourseId,
  userId,
  questionMetadataId,
  opts = {}
) {
  let bankIds = [];
  if (Array.isArray(opts.questionBankIds) && opts.questionBankIds.length > 0) {
    bankIds = opts.questionBankIds.map(String).filter(Boolean);
  } else if (opts.questionBankId != null && opts.questionBankId !== '') {
    bankIds = [String(opts.questionBankId)];
  }

  if (bankIds.length === 0) {
    const defaultBank = await ensureDefaultBank(localCourseId, userId);
    bankIds = [String(defaultBank.id)];
  }

  for (const bankId of bankIds) {
    try {
      await addQuestionToBank(localCourseId, userId, bankId, questionMetadataId);
    } catch (error) {
      if (error.status === 409) continue;
      throw error;
    }
  }
  return bankIds;
}

/**
 * Local metadata ids for a Core bank: approved members and Canvas-pending shells.
 * @returns {Promise<{ memberIds: number[], pendingIds: number[] }>}
 */
export async function listLocalQuestionIdsForBank(localCourseId, userId, bankId) {
  const { coreCourseId } = await resolveCoreCourse(localCourseId, userId);
  const payload = await callCore(() =>
    eduaiService.listQuestionBankMemberships(coreCourseId, bankId)
  );
  const memberships = Array.isArray(payload?.memberships)
    ? payload.memberships
    : [];
  const coreQuestionIds = memberships
    .map((m) => m.questionId)
    .filter((id) => typeof id === 'string' && id.length > 0);

  const memberVariants =
    coreQuestionIds.length > 0
      ? await Variants.findAll({
          where: { coreQuestionId: { [Op.in]: coreQuestionIds } },
          attributes: ['questionMetadataId']
        })
      : [];

  const memberIds = [
    ...new Set(
      memberVariants
        .map((v) => Number(v.questionMetadataId))
        .filter((id) => Number.isInteger(id))
    )
  ];

  const mappings = await CanvasBankQuestionMapping.findAll({
    where: { localBankId: String(bankId) },
    attributes: ['localQuestionMetadataId']
  });
  const mappedMetadataIds = [
    ...new Set(
      mappings
        .map((m) => Number(m.localQuestionMetadataId))
        .filter((id) => Number.isInteger(id))
    )
  ];

  let pendingIds = [];
  if (mappedMetadataIds.length > 0) {
    const approvedForMapped = await Variants.findAll({
      where: {
        questionMetadataId: { [Op.in]: mappedMetadataIds },
        coreQuestionId: { [Op.ne]: null }
      },
      attributes: ['questionMetadataId']
    });
    const approvedSet = new Set(
      approvedForMapped.map((v) => Number(v.questionMetadataId))
    );
    pendingIds = mappedMetadataIds.filter((id) => !approvedSet.has(id));
  }

  return { memberIds, pendingIds };
}

/**
 * Local question metadata ids that belong to a Core bank (members + pending).
 */
export async function listExternalQuestionIdsForBank(localCourseId, userId, bankId) {
  const { memberIds, pendingIds } = await listLocalQuestionIdsForBank(
    localCourseId,
    userId,
    bankId
  );
  return [...memberIds, ...pendingIds];
}

/** @deprecated local backfill — Core ensures default banks; no-op for API compatibility */
export async function backfillDefaultBanks() {
  return { coursesProcessed: 0, banksCreated: 0, membershipsCreated: 0 };
}
