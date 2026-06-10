import { afterEach, describe, expect, it, vi } from "vitest";

const TEST_KEY = "test-encryption-key-32bytes!!";

describe("student-id encryption", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips through encrypt and readStoredStudentId", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
    const {
      encryptStudentIdForStorage,
      readStoredStudentId,
      studentIdLookupKey,
    } = await import("~/lib/canvas/student-id.server");

    const stored = encryptStudentIdForStorage("12345678");
    expect(readStoredStudentId(stored)).toBe("12345678");
    expect(studentIdLookupKey("12345678")).toMatch(/^[a-f0-9]{64}$/);
    expect(studentIdLookupKey("12345678")).not.toBe(studentIdLookupKey("87654321"));
  });

  it("reads legacy plaintext student ids", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
    const { readStoredStudentId, isLegacyPlaintextStudentId } = await import(
      "~/lib/canvas/student-id.server"
    );

    expect(readStoredStudentId("student_1")).toBe("student_1");
    expect(isLegacyPlaintextStudentId("student_1")).toBe(true);
  });

  it("prepareStudentIdStorage returns encrypted value and lookup key", async () => {
    vi.stubEnv("ENCRYPTION_KEY", TEST_KEY);
    const { prepareStudentIdStorage, readStoredStudentId } = await import(
      "~/lib/canvas/student-id.server"
    );

    const prepared = prepareStudentIdStorage("student_2");
    expect(prepared.studentIdLookup).toMatch(/^[a-f0-9]{64}$/);
    expect(readStoredStudentId(prepared.studentId)).toBe("student_2");
  });
});
