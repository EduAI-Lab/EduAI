// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  ALL_CONDITIONS,
  CONDITIONS,
  EvalAdhdAssistModeError,
  LEGACY_MODE_ALIASES,
  resolveConditions,
} from "~/lib/eval/eval-adhd-assist-conditions";

describe("resolveConditions", () => {
  it("returns all three Form A arms for all-three", () => {
    expect(resolveConditions("all-three")).toEqual([...ALL_CONDITIONS]);
  });

  it("returns a single arm for each canonical mode", () => {
    expect(resolveConditions("baseline")).toEqual(["baseline"]);
    expect(resolveConditions("assist-prompt-only")).toEqual(["assist-prompt-only"]);
    expect(resolveConditions("assist-oversight")).toEqual(["assist-oversight"]);
  });

  it("maps legacy off/on aliases and warns", () => {
    const warnings: string[] = [];
    expect(
      resolveConditions("off", { onWarn: (m) => warnings.push(m) }),
    ).toEqual(["baseline"]);
    expect(warnings.some((w) => w.includes("deprecated"))).toBe(true);

    warnings.length = 0;
    expect(
      resolveConditions("on", { onWarn: (m) => warnings.push(m) }),
    ).toEqual(["assist-oversight"]);
    expect(warnings.some((w) => w.includes("deprecated"))).toBe(true);
  });

  it("maps deprecated both to baseline + assist-oversight with a warning", () => {
    const warnings: string[] = [];
    expect(
      resolveConditions("both", { onWarn: (m) => warnings.push(m) }),
    ).toEqual(["baseline", "assist-oversight"]);
    expect(warnings.some((w) => w.includes("both is deprecated"))).toBe(true);
  });

  it("throws EvalAdhdAssistModeError for unknown modes", () => {
    expect(() => resolveConditions("invalid-mode")).toThrow(EvalAdhdAssistModeError);
  });
});

describe("CONDITIONS metadata", () => {
  it("sets adhdAssist and oversight expectations per arm", () => {
    expect(CONDITIONS.baseline.adhdAssist).toBe(false);
    expect(CONDITIONS.baseline.requiresOversight).toBeNull();

    expect(CONDITIONS["assist-prompt-only"].adhdAssist).toBe(true);
    expect(CONDITIONS["assist-prompt-only"].requiresOversight).toBe(false);

    expect(CONDITIONS["assist-oversight"].adhdAssist).toBe(true);
    expect(CONDITIONS["assist-oversight"].requiresOversight).toBe(true);
  });

  it("keeps legacy aliases aligned with canonical keys", () => {
    expect(LEGACY_MODE_ALIASES.off).toBe("baseline");
    expect(LEGACY_MODE_ALIASES.on).toBe("assist-oversight");
  });
});
