/**
 * Question bank operations proxied to EduAI Core.
 * Local QM courses resolve via `Course.coreCourseId`.
 * Membership stores QM QuestionMetadata ids as externalQuestionId on Core.
 */
import { prisma } from '../config/database.js';
import {
  listQuestionBanksFromCore,
  createQuestionBankOnCore,
  updateQuestionBankOnCore,
  deleteQuestionBankOnCore,
  listQuestionBankMembershipsFromCore,
  addQuestionBankMembershipOnCore,
  removeQuestionBankMembershipOnCore,
} from './coreApiService.js';

export const DEFAULT_BANK_NAME = 'Course bank';
const SOURCE = 'question-maker';

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
    const status = error.status || error.response?.status || 502;
    const message =
      error.body?.error ||
      error.response?.data?.error ||
      error.response?.data?.message ||
      error.message ||
      'EduAI Core request failed';
    throw coreError(message, status);
  }
}

/**
 * Resolve a local QM course to its Core course CUID.
 * @param {number} localCourseId
 * @param {string} userId Core user CUID (used for ownership/access context)
 * @returns {Promise<{ localCourse: object, coreCourseId: string }>}
 */
export async function resolveCoreCourse(localCourseId, userId) {
  const parsedId = Number(localCourseId);
  if (!Number.isInteger(parsedId)) {
    throw coreError('Invalid course id', 400);
  }

  const localCourse = await prisma.course.findUnique({
    where: { id: parsedId },
  });
  if (!localCourse) {
    throw coreError('Course not found', 404);
  }

  // Prefer linked Core id; owner check is soft — routes use requireCourseAccess.
  if (!localCourse.coreCourseId) {
    throw coreError(
      'Course is not linked to EduAI Core. Link the course before managing question banks.',
      400,
    );
  }

  return { localCourse, coreCourseId: String(localCourse.coreCourseId) };
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
    updatedAt: bank.updatedAt,
  };
}

export async function ensureDefaultBank(localCourseId, userId) {
  const { coreCourseId } = await resolveCoreCourse(localCourseId, userId);
  const payload = await callCore(() => listQuestionBanksFromCore(coreCourseId));
  const list = Array.isArray(payload?.banks) ? payload.banks : [];
  let defaultBank = list.find((b) => b.isDefault) || list[0];
  if (!defaultBank) {
    throw coreError('Failed to ensure default question bank in Core', 500);
  }
  return mapBank(defaultBank, localCourseId);
}

export async function listBanks(localCourseId, userId) {
  const { coreCourseId } = await resolveCoreCourse(localCourseId, userId);
  const payload = await callCore(() => listQuestionBanksFromCore(coreCourseId));
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
    createQuestionBankOnCore(coreCourseId, {
      name: trimmed,
      description,
    }),
  );
  return mapBank(bank, localCourseId);
}

export async function updateBank(localCourseId, userId, bankId, payload) {
  const { coreCourseId } = await resolveCoreCourse(localCourseId, userId);
  const bank = await callCore(() =>
    updateQuestionBankOnCore(coreCourseId, bankId, payload),
  );
  return mapBank(bank, localCourseId);
}

export async function deleteBank(localCourseId, userId, bankId, options = {}) {
  const { coreCourseId } = await resolveCoreCourse(localCourseId, userId);
  return callCore(() =>
    deleteQuestionBankOnCore(coreCourseId, bankId, {
      moveMembershipsToBankId: options.moveMembershipsToBankId,
    }),
  );
}

export async function addQuestionToBank(localCourseId, userId, bankId, questionMetadataId) {
  const question = await prisma.questionMetadata.findUnique({
    where: { id: Number(questionMetadataId) },
  });
  if (!question) {
    throw coreError('Question not found', 404);
  }
  if (Number(question.courseId) !== Number(localCourseId)) {
    throw coreError('Question and bank must belong to the same course', 400);
  }
  const { coreCourseId } = await resolveCoreCourse(localCourseId, userId);
  const membership = await callCore(() =>
    addQuestionBankMembershipOnCore(coreCourseId, bankId, {
      externalQuestionId: String(questionMetadataId),
      source: SOURCE,
    }),
  );
  return { membership, created: true };
}

export async function removeQuestionFromBank(
  localCourseId,
  userId,
  bankId,
  questionMetadataId,
) {
  const { coreCourseId } = await resolveCoreCourse(localCourseId, userId);
  return callCore(() =>
    removeQuestionBankMembershipOnCore(
      coreCourseId,
      bankId,
      String(questionMetadataId),
      SOURCE,
    ),
  );
}

/**
 * Attach a newly created local question to one or more Core banks.
 */
export async function attachQuestionToBanks(
  localCourseId,
  userId,
  questionMetadataId,
  opts = {},
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
    await addQuestionToBank(localCourseId, userId, bankId, questionMetadataId);
  }
  return bankIds;
}

/**
 * External question ids that belong to a Core bank (for filtering local QM questions).
 */
export async function listExternalQuestionIdsForBank(localCourseId, userId, bankId) {
  const { coreCourseId } = await resolveCoreCourse(localCourseId, userId);
  const payload = await callCore(() =>
    listQuestionBankMembershipsFromCore(coreCourseId, bankId),
  );
  const memberships = Array.isArray(payload?.memberships) ? payload.memberships : [];
  return memberships
    .filter((m) => (m.source || SOURCE) === SOURCE)
    .map((m) => Number(m.externalQuestionId))
    .filter((id) => Number.isInteger(id));
}

/** @deprecated Core ensures default banks; no-op for API compatibility */
export async function backfillDefaultBanks() {
  return { coursesProcessed: 0, banksCreated: 0, membershipsCreated: 0 };
}
