// @vitest-environment node

import { describe, it, expect } from "vitest";

import {
  parseEnrollmentCsv,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
} from "~/lib/courses/enrollments-csv.server";

/** Narrowing helper: every happy-path assertion below wants `rows`/`errors`. */
function expectParsed(result: ReturnType<typeof parseEnrollmentCsv>) {
  if (!result.ok) throw new Error(`expected a parsed result, got ${result.error}`);
  return result;
}

describe("parseEnrollmentCsv — header handling", () => {
  it("accepts a plain header and parses valid rows, defaulting role to STUDENT", () => {
    const parsed = expectParsed(parseEnrollmentCsv("email\nalice@test.edu\nbob@test.edu\n"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      { line: 2, email: "alice@test.edu", role: "STUDENT" },
      { line: 3, email: "bob@test.edu", role: "STUDENT" },
    ]);
  });

  it("tolerates a UTF-8 BOM in front of the header (Excel exports carry one)", () => {
    const parsed = expectParsed(parseEnrollmentCsv("﻿email,role\ncarol@test.edu,TA\n"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([{ line: 2, email: "carol@test.edu", role: "TA" }]);
  });

  it("matches header columns case-insensitively and ignores surrounding space", () => {
    const parsed = expectParsed(parseEnrollmentCsv(" Email , Role \ndan@test.edu,student\n"));
    expect(parsed.rows).toEqual([{ line: 2, email: "dan@test.edu", role: "STUDENT" }]);
  });

  it("rejects a file with no email column", () => {
    const result = parseEnrollmentCsv("name,role\nAlice,STUDENT\n");
    expect(result).toEqual({
      ok: false,
      error: "MISSING_EMAIL_COLUMN",
      message: expect.stringContaining("email"),
    });
  });

  it("rejects an empty file", () => {
    expect(parseEnrollmentCsv("   \n\n").ok).toBe(false);
    expect(parseEnrollmentCsv("").ok).toBe(false);
  });
});

describe("parseEnrollmentCsv — line endings and blank lines", () => {
  it("handles CRLF line endings", () => {
    const parsed = expectParsed(
      parseEnrollmentCsv("email,role\r\nalice@test.edu,TA\r\nbob@test.edu,STUDENT\r\n"),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      { line: 2, email: "alice@test.edu", role: "TA" },
      { line: 3, email: "bob@test.edu", role: "STUDENT" },
    ]);
  });

  it("skips blank trailing lines without reporting them as errors", () => {
    const parsed = expectParsed(parseEnrollmentCsv("email\nalice@test.edu\n\n   \n\r\n"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
  });

  it("skips blank interior lines but keeps physical line numbers accurate", () => {
    const parsed = expectParsed(parseEnrollmentCsv("email\nalice@test.edu\n\nbob@test.edu\n"));
    expect(parsed.rows.map((r) => r.line)).toEqual([2, 4]);
  });

  it("unquotes quoted fields and keeps commas inside them out of the split", () => {
    const parsed = expectParsed(parseEnrollmentCsv('email,name\n"alice@test.edu","Doe, Alice"\n'));
    expect(parsed.rows).toEqual([{ line: 2, email: "alice@test.edu", role: "STUDENT" }]);
  });

  it("keeps a mid-field quote instead of swallowing it, so the cell is reported", () => {
    // RFC 4180: a quote only delimits when it leads the field. Dropping one
    // from the middle would turn `a"lice@test.edu` into a well-formed address
    // nobody typed — the import would then report USER_NOT_FOUND for a stranger
    // rather than pointing the instructor at the malformed cell.
    const parsed = expectParsed(parseEnrollmentCsv('email\na"lice@test.edu\nbob@test.edu\n'));

    expect(parsed.rows.map((r) => r.email)).toEqual(["bob@test.edu"]);
    expect(parsed.errors).toEqual([
      { line: 2, email: 'a"lice@test.edu', code: "INVALID_EMAIL", message: expect.any(String) },
    ]);
  });

  it("still honours a quote that closes and is followed by text", () => {
    const parsed = expectParsed(parseEnrollmentCsv('email,name\n"alice@test.edu","Doe" Jr\n'));
    expect(parsed.rows).toEqual([{ line: 2, email: "alice@test.edu", role: "STUDENT" }]);
  });
});

describe("parseEnrollmentCsv — per-row errors", () => {
  it("reports a malformed email without aborting the file", () => {
    const parsed = expectParsed(
      parseEnrollmentCsv("email\nalice@test.edu\nnot-an-email\nbob@test.edu\n"),
    );
    expect(parsed.rows.map((r) => r.email)).toEqual(["alice@test.edu", "bob@test.edu"]);
    expect(parsed.errors).toEqual([
      { line: 3, email: "not-an-email", code: "INVALID_EMAIL", message: expect.any(String) },
    ]);
  });

  it("reports a missing email cell", () => {
    const parsed = expectParsed(parseEnrollmentCsv("email,role\n,STUDENT\n"));
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual([
      { line: 2, email: null, code: "MISSING_EMAIL", message: expect.any(String) },
    ]);
  });

  it("reports an unknown role", () => {
    const parsed = expectParsed(parseEnrollmentCsv("email,role\nalice@test.edu,OVERLORD\n"));
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors).toEqual([
      { line: 2, email: "alice@test.edu", code: "INVALID_ROLE", message: expect.any(String) },
    ]);
  });

  it("keeps the first occurrence of a duplicated email and flags the rest", () => {
    const parsed = expectParsed(
      parseEnrollmentCsv("email\nalice@test.edu\nbob@test.edu\nALICE@test.edu\n"),
    );
    expect(parsed.rows.map((r) => r.email)).toEqual(["alice@test.edu", "bob@test.edu"]);
    expect(parsed.errors).toEqual([
      { line: 4, email: "alice@test.edu", code: "DUPLICATE_EMAIL", message: expect.any(String) },
    ]);
  });

  it("imports 97 of 100 rows and reports the 3 bad ones with their line numbers", () => {
    const lines = ["email"];
    for (let i = 1; i <= 100; i += 1) {
      lines.push(i === 10 || i === 50 || i === 90 ? "bad-row-no-at-sign" : `student${i}@test.edu`);
    }
    const parsed = expectParsed(parseEnrollmentCsv(lines.join("\n")));
    expect(parsed.rows).toHaveLength(97);
    expect(parsed.errors).toHaveLength(3);
    // Data row i sits on physical line i + 1.
    expect(parsed.errors.map((e) => e.line)).toEqual([11, 51, 91]);
    expect(parsed.totalDataRows).toBe(100);
  });
});

describe("parseEnrollmentCsv — caps", () => {
  it("rejects a file over the row cap without parsing it", () => {
    const lines = ["email"];
    for (let i = 0; i <= MAX_CSV_ROWS; i += 1) lines.push(`student${i}@test.edu`);
    expect(parseEnrollmentCsv(lines.join("\n"))).toEqual({
      ok: false,
      error: "TOO_MANY_ROWS",
      message: expect.stringContaining(String(MAX_CSV_ROWS)),
    });
  });

  it("rejects a file over the byte cap", () => {
    const padded = `email\n${"a".repeat(MAX_CSV_BYTES)}@test.edu\n`;
    expect(parseEnrollmentCsv(padded)).toEqual({
      ok: false,
      error: "FILE_TOO_LARGE",
      message: expect.stringContaining(String(MAX_CSV_BYTES)),
    });
  });
});
