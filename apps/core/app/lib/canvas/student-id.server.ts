import { createHmac } from "node:crypto";

import {
  decrypt,
  encrypt,
  isEncrypted,
  CanvasCredentialDecryptError,
} from "~/lib/canvas/encryption";

/** Normalizes a student number / Canvas sis_user_id for comparison. */
export function normalizeStudentId(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getEncryptionKey(): string {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY is not set in environment variables");
  }
  return encryptionKey;
}

/** Deterministic HMAC for unique constraint and equality lookups (not reversible alone). */
export function studentIdLookupKey(normalizedStudentId: string): string {
  return createHmac("sha256", getEncryptionKey())
    .update(`student-id:${normalizedStudentId}`)
    .digest("hex");
}

/** Encrypts a normalized student number for `User.studentId` at rest. */
export function encryptStudentIdForStorage(normalizedStudentId: string): string {
  return encrypt(normalizedStudentId);
}

/** Decrypts `User.studentId` from storage; supports legacy plaintext rows. */
export function readStoredStudentId(stored: string | null | undefined): string | null {
  if (stored == null) {
    return null;
  }
  try {
    return normalizeStudentId(decrypt(stored));
  } catch (error) {
    if (error instanceof CanvasCredentialDecryptError) {
      return null;
    }
    throw error;
  }
}

/** The pair a student id is stored as: the ciphertext, and its lookup digest. */
export type StoredStudentId = { studentId: string; studentIdLookup: string };

export function prepareStudentIdStorage(normalizedStudentId: string): StoredStudentId {
  return {
    studentId: encryptStudentIdForStorage(normalizedStudentId),
    studentIdLookup: studentIdLookupKey(normalizedStudentId),
  };
}

/** The same pair, cleared — what an update writes to drop a stored student id. */
export type ClearedStudentId = { studentId: null; studentIdLookup: null };

export function clearStudentIdStorage(): ClearedStudentId {
  return {
    studentId: null,
    studentIdLookup: null,
  };
}

/** True when the DB value is still legacy plaintext (pre-encryption migration). */
export function isLegacyPlaintextStudentId(stored: string | null | undefined): boolean {
  if (!stored) {
    return false;
  }
  return !isEncrypted(stored);
}

/** Prisma filter matching a normalized student number (encrypted + legacy plaintext). */
export function studentIdMatchFilter(normalizedStudentId: string) {
  return {
    OR: [
      { studentIdLookup: studentIdLookupKey(normalizedStudentId) },
      { studentId: normalizedStudentId, studentIdLookup: null },
    ],
  };
}

/** Prisma filter matching any of several normalized student numbers. */
export function studentIdsMatchFilter(normalizedStudentIds: string[]) {
  if (normalizedStudentIds.length === 0) {
    return { id: { in: [] as string[] } };
  }

  return {
    OR: [
      { studentIdLookup: { in: normalizedStudentIds.map(studentIdLookupKey) } },
      {
        studentId: { in: normalizedStudentIds },
        studentIdLookup: null,
      },
    ],
  };
}

/** Encrypts a normalized Canvas sis_user_id for roster staging at rest. */
/** The same pair under the roster-staging column names. */
export type StoredRosterSisUserId = { sisUserId: string; sisUserIdLookup: string };

export function prepareRosterSisUserIdStorage(normalizedStudentId: string): StoredRosterSisUserId {
  const prepared = prepareStudentIdStorage(normalizedStudentId);
  return {
    sisUserId: prepared.studentId,
    sisUserIdLookup: prepared.studentIdLookup,
  };
}

/** The roster-staging pair, cleared. */
export type ClearedRosterSisUserId = { sisUserId: null; sisUserIdLookup: null };

export function clearRosterSisUserIdStorage(): ClearedRosterSisUserId {
  return {
    sisUserId: null,
    sisUserIdLookup: null,
  };
}

/** Prisma filter matching roster rows by normalized student number. */
export function rosterSisUserIdMatchFilter(normalizedStudentId: string) {
  return {
    OR: [
      { sisUserIdLookup: studentIdLookupKey(normalizedStudentId) },
      { sisUserId: normalizedStudentId, sisUserIdLookup: null },
    ],
  };
}

/** Prisma filter matching roster rows for a user who already has a lookup key set. */
export function rosterSisUserIdMatchForUser(input: {
  studentIdLookup: string | null | undefined;
  studentId: string | null | undefined;
}) {
  const normalizedStudentId = readStoredStudentId(input.studentId);

  if (input.studentIdLookup) {
    return {
      OR: [
        { sisUserIdLookup: input.studentIdLookup },
        ...(normalizedStudentId ? [{ sisUserId: normalizedStudentId, sisUserIdLookup: null }] : []),
      ],
    };
  }

  if (!normalizedStudentId) {
    return { id: { in: [] as string[] } };
  }

  return rosterSisUserIdMatchFilter(normalizedStudentId);
}
