// @vitest-environment node
/**
 * #1817: the assistant gate — the full scope truth table from §3 of
 * docs/implementations/ai-help-assistant-brief.md, the staff bypass, the "no
 * enabled provider" row, and the platform kill switch binding admins too.
 */
import { describe, expect, it } from "vitest";

import {
  docsSourceAvailable,
  gateSnapshot,
  materialSourceAvailable,
  materialSourcePossible,
  scopeFor,
  type AssistantAvailability,
} from "~/lib/assistant/assistant-gate.server";
import { defaultAssistantSettings } from "~/lib/assistant/assistant-settings";
import type { PageContextResolution } from "~/lib/assistant/material-context.server";
import { accessLevelFor } from "~/lib/auth/course-access.server";

function availability(
  overrides: Partial<AssistantAvailability> & {
    help?: boolean;
    studentMaterial?: boolean;
  } = {},
): AssistantAvailability {
  const settings = defaultAssistantSettings();
  settings.enableHelpAssistant = overrides.help ?? true;
  settings.enableStudentMaterialQuestions = overrides.studentMaterial ?? true;
  return {
    platformEnabled: overrides.platformEnabled ?? true,
    hasEnabledProvider: overrides.hasEnabledProvider ?? true,
    settings,
  };
}

function resolved(
  overrides: Partial<Extract<PageContextResolution, { kind: "resolved" }>> = {},
): PageContextResolution {
  return {
    kind: "resolved",
    courseId: "c1",
    courseLabel: "CS101 — Intro",
    courseAllowsAi: true,
    access: accessLevelFor("student"),
    canView: true,
    material: null,
    ...overrides,
  };
}

describe("scopeFor — the §3 truth table", () => {
  it("off-course, help on → docs only", () => {
    expect(scopeFor(availability(), null)).toEqual({ docs: true, material: false });
  });

  it("in a course, help on, material eligible → docs + material", () => {
    expect(scopeFor(availability(), resolved())).toEqual({ docs: true, material: true });
  });

  it("in a course, help on, material NOT eligible → docs only", () => {
    expect(scopeFor(availability(), resolved({ canView: false }))).toEqual({
      docs: true,
      material: false,
    });
  });

  it("in a course, help off, material eligible → material only", () => {
    expect(scopeFor(availability({ help: false }), resolved())).toEqual({
      docs: false,
      material: true,
    });
  });

  it("anywhere, help off, material not eligible → nothing", () => {
    expect(scopeFor(availability({ help: false }), null)).toEqual({ docs: false, material: false });
    expect(scopeFor(availability({ help: false }), resolved({ courseAllowsAi: false }))).toEqual({
      docs: false,
      material: false,
    });
  });
});

describe("material eligibility", () => {
  it("a course opted out of AI contributes no material, even for its own staff", () => {
    expect(
      materialSourceAvailable(
        availability(),
        resolved({ courseAllowsAi: false, access: accessLevelFor("instructor") }),
      ),
    ).toBe(false);
  });

  it("the student toggle off blocks students but not the course's own instructor (staff bypass)", () => {
    const off = availability({ studentMaterial: false });
    expect(materialSourceAvailable(off, resolved())).toBe(false);
    expect(materialSourceAvailable(off, resolved({ access: accessLevelFor("ta") }))).toBe(false);
    expect(materialSourceAvailable(off, resolved({ access: accessLevelFor("instructor") }))).toBe(
      true,
    );
    expect(materialSourceAvailable(off, resolved({ access: accessLevelFor("admin") }))).toBe(true);
  });

  it("no access at all, or an unresolved hint, never grants material", () => {
    expect(materialSourceAvailable(availability(), resolved({ access: null }))).toBe(false);
    expect(materialSourceAvailable(availability(), { kind: "none" })).toBe(false);
    expect(materialSourceAvailable(availability(), { kind: "missing" })).toBe(false);
  });

  it("materialSourcePossible keeps the widget mounted for staff with the student toggle off", () => {
    const off = availability({ studentMaterial: false });
    expect(materialSourcePossible(off, "STUDENT")).toBe(false);
    expect(materialSourcePossible(off, "INSTRUCTOR")).toBe(true);
    expect(materialSourcePossible(off, "ADMIN")).toBe(true);
    expect(materialSourcePossible(availability(), "STUDENT")).toBe(true);
  });
});

describe("never advertise a source whose request could only be refused", () => {
  it("no enabled provider → nothing applies and nothing mounts", () => {
    const none = availability({ hasEnabledProvider: false });
    expect(docsSourceAvailable(none)).toBe(false);
    expect(materialSourcePossible(none, "ADMIN")).toBe(false);
    expect(scopeFor(none, resolved())).toEqual({ docs: false, material: false });
    expect(gateSnapshot(none, "ADMIN")).toEqual({ mounted: false, docs: false });
  });
});

describe("the platform AI kill switch", () => {
  it("stops every source for every role, administrators included", () => {
    const frozen = availability({ platformEnabled: false });
    for (const role of ["STUDENT", "INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]) {
      expect(gateSnapshot(frozen, role)).toEqual({ mounted: false, docs: false });
    }
    expect(scopeFor(frozen, resolved({ access: accessLevelFor("admin") }))).toEqual({
      docs: false,
      material: false,
    });
  });
});

describe("gateSnapshot — the root loader's render condition", () => {
  it("mounts for docs, or for possible material grounding, and reports docs separately", () => {
    expect(gateSnapshot(availability(), "STUDENT")).toEqual({ mounted: true, docs: true });
    expect(gateSnapshot(availability({ help: false }), "STUDENT")).toEqual({
      mounted: true,
      docs: false,
    });
    expect(gateSnapshot(availability({ help: false, studentMaterial: false }), "STUDENT")).toEqual({
      mounted: false,
      docs: false,
    });
  });
});
