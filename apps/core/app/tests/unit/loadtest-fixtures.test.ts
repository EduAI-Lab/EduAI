import { describe, expect, it } from "vitest";
import { emailForVu, studentNumberForVu } from "../../../loadtest/scripts/loadtest-fixtures";

describe("loadtest fixture helpers", () => {
  it("assigns 8-digit student numbers away from the prisma/seed.ts 1000000x range", () => {
    expect(studentNumberForVu(1)).toBe("20000001");
    expect(studentNumberForVu(5)).toBe("20000005");
    expect(studentNumberForVu(500)).toBe("20000500");
    expect(studentNumberForVu(1)).toHaveLength(8);
  });

  it("keeps VU emails zero-padded", () => {
    expect(emailForVu(1)).toBe("loadtest.vu-001@eduai.local");
    expect(emailForVu(500)).toBe("loadtest.vu-500@eduai.local");
  });

  it("rejects a non-positive VU index", () => {
    expect(() => studentNumberForVu(0)).toThrow(/positive integer/);
    expect(() => studentNumberForVu(1.5)).toThrow(/positive integer/);
  });
});
