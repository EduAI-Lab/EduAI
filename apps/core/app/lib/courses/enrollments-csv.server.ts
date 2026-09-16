/**
 * Bulk enrollment from a CSV roster (#1756).
 *
 * Two halves, deliberately split:
 *   - {@link parseEnrollmentCsv} is PURE — no DB, no I/O, no clock. Everything
 *     about the file format (BOM, CRLF, quoting, caps, per-row validation) is
 *     decided here and is unit-testable without a database.
 *   - {@link importEnrollmentRows} walks the parsed rows and delegates every
 *     write to `addEnrollment`, which owns authorization, the instructor-floor
 *     invariant and the reactivate-on-conflict behaviour. Writing to
 *     `prisma.enrollment` directly from here would silently bypass all of it.
 *
 * NOT TRANSACTIONAL, by design. A 500-row roster is imported row by row and the
 * caller gets a per-row result summary: 3 bad rows out of 100 import the other
 * 97 rather than rolling the batch back. An instructor fixing three typos should
 * not have to re-upload the ninety-seven rows that were already fine, and a
 * partial import is safe to re-upload because `addEnrollment` is idempotent for
 * an already-active enrollment.
 */
import type { EnrollmentRole } from "@prisma/client";

import prisma from "~/lib/prisma.server";
import {
  addEnrollment,
  canAddEnrollmentRole,
  isEnrollmentRole,
} from "~/lib/courses/enrollments.server";

/**
 * Upload caps. A roster CSV is a few dozen bytes per student, so 256 KiB is
 * roughly 10x the biggest plausible real file while still being cheap to buffer
 * in memory, and 500 rows comfortably covers a large lecture section.
 *
 * Both are enforced in the pure parser so no caller can forget them; the route
 * additionally short-circuits on `Content-Length` so an oversized body is
 * rejected before it is read.
 */
export const MAX_CSV_BYTES = 262_144; // 256 KiB
export const MAX_CSV_ROWS = 500;

/** A roster row with no `role` cell is a student. */
const DEFAULT_ROLE = "STUDENT";

/**
 * Deliberately stricter than RFC 5322 and deliberately not zod's email rule:
 * the job here is to catch a mis-shaped spreadsheet cell (`Alice Smith`, a bare
 * student number, a stray column) before it becomes a pointless DB round trip.
 * A real address that this rejects is rare; a real address that reaches the DB
 * and simply has no account is reported as USER_NOT_FOUND anyway.
 */
const EMAIL_PATTERN = /^[^\s@,;"']+@[^\s@,;"']+\.[^\s@,;"']+$/;

/** A row that parsed cleanly and is ready to be handed to `addEnrollment`. */
export type EnrollmentCsvRow = {
  /** 1-based physical line in the uploaded file; the header is line 1. */
  line: number;
  email: string;
  role: EnrollmentRole;
};

export type EnrollmentCsvRowErrorCode =
  | "MISSING_EMAIL"
  | "INVALID_EMAIL"
  | "INVALID_ROLE"
  | "DUPLICATE_EMAIL";

export type EnrollmentCsvRowError = {
  line: number;
  /** The offending cell when there was one, `null` when the cell was empty. */
  email: string | null;
  code: EnrollmentCsvRowErrorCode;
  message: string;
};

/** Whole-file rejections: nothing in the file can be used. */
export type EnrollmentCsvFileErrorCode =
  | "EMPTY_FILE"
  | "MISSING_EMAIL_COLUMN"
  | "TOO_MANY_ROWS"
  | "FILE_TOO_LARGE";

export type EnrollmentCsvParseResult =
  | { ok: false; error: EnrollmentCsvFileErrorCode; message: string }
  | {
      ok: true;
      rows: EnrollmentCsvRow[];
      errors: EnrollmentCsvRowError[];
      /** Non-blank data rows seen, i.e. `rows.length + errors.length`. */
      totalDataRows: number;
    };

/**
 * Split one CSV line on commas, honouring double-quoted fields (`"Doe, Alice"`)
 * and the doubled-quote escape (`""`). Small on purpose — a roster CSV never
 * contains embedded newlines inside a quoted field, and supporting those would
 * mean giving up line-at-a-time parsing and therefore accurate line numbers.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

/**
 * Parse a roster CSV.
 *
 * Format: a header row is REQUIRED. `email` is the only required column; `role`
 * is optional and defaults to STUDENT. Header names are matched case-
 * insensitively after trimming, any other columns (`name`, `student_id`, …) are
 * ignored, a leading UTF-8 BOM is stripped, CR/LF/CRLF all terminate a line, and
 * blank lines are skipped without being reported as errors.
 *
 * Never throws and never aborts on a bad row: a malformed row becomes an entry
 * in `errors` carrying its physical line number, and parsing continues.
 */
export function parseEnrollmentCsv(text: string): EnrollmentCsvParseResult {
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > MAX_CSV_BYTES) {
    return {
      ok: false,
      error: "FILE_TOO_LARGE",
      message: `CSV is ${byteLength} bytes; the maximum is ${MAX_CSV_BYTES} bytes.`,
    };
  }

  // Excel and Google Sheets both prefix UTF-8 exports with a BOM. Left in place
  // it becomes part of the first header name and "email" silently stops matching.
  const withoutBom = text.startsWith("﻿") ? text.slice(1) : text;
  const lines = withoutBom.split(/\r\n|\r|\n/);

  const headerIndex = lines.findIndex((line) => line.trim() !== "");
  if (headerIndex === -1) {
    return { ok: false, error: "EMPTY_FILE", message: "The CSV file is empty." };
  }

  const header = splitCsvLine(lines[headerIndex]).map((name) => name.toLowerCase());
  const emailColumn = header.indexOf("email");
  if (emailColumn === -1) {
    return {
      ok: false,
      error: "MISSING_EMAIL_COLUMN",
      message: 'The CSV needs a header row with an "email" column.',
    };
  }
  const roleColumn = header.indexOf("role");

  const dataLines = lines.slice(headerIndex + 1);
  const dataRowCount = dataLines.filter((line) => line.trim() !== "").length;
  if (dataRowCount > MAX_CSV_ROWS) {
    return {
      ok: false,
      error: "TOO_MANY_ROWS",
      message: `CSV has ${dataRowCount} rows; the maximum is ${MAX_CSV_ROWS} rows per upload.`,
    };
  }

  const rows: EnrollmentCsvRow[] = [];
  const errors: EnrollmentCsvRowError[] = [];
  const seenEmails = new Set<string>();

  dataLines.forEach((rawLine, index) => {
    if (rawLine.trim() === "") return;
    // +1 to step past the header, +1 again because file lines are 1-based.
    const line = headerIndex + index + 2;
    const fields = splitCsvLine(rawLine);
    const email = (fields[emailColumn] ?? "").toLowerCase();

    if (email === "") {
      errors.push({ line, email: null, code: "MISSING_EMAIL", message: "Missing email address." });
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      errors.push({
        line,
        email,
        code: "INVALID_EMAIL",
        message: `"${email}" is not a valid email address.`,
      });
      return;
    }

    const rawRole = roleColumn === -1 ? "" : (fields[roleColumn] ?? "").toUpperCase();
    const role = rawRole === "" ? DEFAULT_ROLE : rawRole;
    // `isEnrollmentRole` is the same guard the single-add path validates with,
    // so the CSV column can never name a role the REST body could not.
    if (!isEnrollmentRole(role)) {
      errors.push({
        line,
        email,
        code: "INVALID_ROLE",
        message: `"${rawRole}" is not a valid role. Use STUDENT, TA or INSTRUCTOR.`,
      });
      return;
    }

    if (seenEmails.has(email)) {
      errors.push({
        line,
        email,
        code: "DUPLICATE_EMAIL",
        message: `"${email}" appears more than once in this file.`,
      });
      return;
    }
    seenEmails.add(email);
    rows.push({ line, email, role });
  });

  return { ok: true, rows, errors, totalDataRows: rows.length + errors.length };
}

export type EnrollmentImportRowErrorCode =
  | EnrollmentCsvRowErrorCode
  | "USER_NOT_FOUND"
  | "FORBIDDEN_ROLE"
  | "IMPORT_FAILED";

export type EnrollmentImportRowError = {
  line: number;
  email: string | null;
  code: EnrollmentImportRowErrorCode;
  message: string;
};

export type EnrollmentImportCreated = {
  enrollmentId: string;
  userId: string;
  email: string;
  role: EnrollmentRole;
};

export type EnrollmentImportSummary = {
  /** Non-blank data rows in the file, good and bad. */
  totalRows: number;
  /** Rows that produced a newly created or reactivated enrollment. */
  imported: number;
  /** Rows whose user was already actively enrolled — a benign re-upload. */
  alreadyEnrolled: number;
  /** Rows that could not be imported, for any reason. */
  failed: number;
  errors: EnrollmentImportRowError[];
  created: EnrollmentImportCreated[];
};

/**
 * Import parsed rows into a course, one `addEnrollment` call per row.
 *
 * `actorRank` is the SAME authority the single-add path uses (§6). Bulk import
 * must never be a privilege-escalation shortcut: an INSTRUCTOR (rank 2) may
 * bulk-add STUDENT and TA rows but an INSTRUCTOR row is rejected exactly as
 * `POST /api/courses/:id/enrollments` would reject it. The explicit
 * `canAddEnrollmentRole` check below turns that into a clear per-row error
 * instead of a bare 403, and `addEnrollment` re-checks it as a backstop, so the
 * guard cannot be lost by editing only one of the two.
 *
 * `parseErrors` are carried straight through into the summary so the caller
 * reports one combined list of line numbers rather than two.
 */
export async function importEnrollmentRows(
  courseId: string,
  rows: EnrollmentCsvRow[],
  parseErrors: EnrollmentCsvRowError[],
  actorRank: number,
): Promise<EnrollmentImportSummary> {
  const errors: EnrollmentImportRowError[] = [...parseErrors];
  const created: EnrollmentImportCreated[] = [];
  let imported = 0;
  let alreadyEnrolled = 0;

  const importable = rows.filter((row) => {
    if (canAddEnrollmentRole(actorRank, row.role)) return true;
    errors.push({
      line: row.line,
      email: row.email,
      code: "FORBIDDEN_ROLE",
      message: `You are not allowed to add a user with the role ${row.role}.`,
    });
    return false;
  });

  // One lookup for the whole file rather than one per row. Emails are stored
  // normalized to lowercase (see auth/server.ts), and the parser lowercases too.
  const users = importable.length
    ? await prisma.user.findMany({
        where: { email: { in: importable.map((row) => row.email) } },
        select: { id: true, email: true },
      })
    : [];
  const userIdByEmail = new Map(users.map((user) => [user.email.toLowerCase(), user.id]));

  for (const row of importable) {
    const userId = userIdByEmail.get(row.email);
    if (!userId) {
      errors.push({
        line: row.line,
        email: row.email,
        code: "USER_NOT_FOUND",
        message: `No EduAI account exists for "${row.email}".`,
      });
      continue;
    }

    const result = await addEnrollment(courseId, { userId, role: row.role }, actorRank);
    if (result.status === "201") {
      imported += 1;
      created.push({
        enrollmentId: result.enrollment.id,
        userId,
        email: row.email,
        role: row.role,
      });
      continue;
    }
    if (result.status === "409" && result.error === "ALREADY_ENROLLED") {
      // Re-uploading last week's roster is expected; an existing active
      // enrollment is a no-op, not a failure the instructor has to act on.
      alreadyEnrolled += 1;
      continue;
    }
    errors.push({
      line: row.line,
      email: row.email,
      code: result.status === "403" ? "FORBIDDEN_ROLE" : "IMPORT_FAILED",
      message: `Could not enroll "${row.email}" (${result.error}).`,
    });
  }

  // Sort so the instructor reads failures in file order, not in the order the
  // parse pass and the import pass happened to produce them.
  errors.sort((a, b) => a.line - b.line);

  return {
    totalRows: rows.length + parseErrors.length,
    imported,
    alreadyEnrolled,
    failed: errors.length,
    errors,
    created,
  };
}
