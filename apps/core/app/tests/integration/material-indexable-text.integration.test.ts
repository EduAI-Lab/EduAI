// @vitest-environment node
//
// The SQL and JS halves of `indexable-text.server.ts` must answer the same for
// the same row (#1795 review). The unit test cannot prove that: it mocks
// `$queryRaw` and asserts the emitted SQL *string*, so the two predicates are
// never evaluated over one input and a drift between them passes CI green.
// That is exactly how `btrim/1` — which trims U+0020 and nothing else — shipped
// against a JS `.trim()` that strips every Unicode space.
//
// Real Postgres, real rows, both predicates, one assertion.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import prisma from "~/lib/prisma.server";
import {
  hasIndexableText,
  selectMaterialIdsWithIndexableText,
} from "~/lib/materials/indexable-text.server";
import { seedUser, seedCourse, enroll, cleanupRbac } from "../helpers/rbac";

/**
 * Every shape `rawText` is known to arrive in, including the ones that only
 * differ between the two predicates. `hasIndexableText` is the authority; the
 * SQL probe has to match it, so no expectation is written down twice.
 */
const CASES: Array<{ label: string; rawText: string | null }> = [
  { label: "null", rawText: null },
  { label: "empty", rawText: "" },
  { label: "spaces", rawText: "   " },
  { label: "newlines", rawText: "\n\n\n" },
  { label: "tabs-and-newlines", rawText: " \t\r\n " },
  { label: "form-feed-vertical-tab", rawText: "\f\v" },
  { label: "nbsp", rawText: " " },
  { label: "bom", rawText: "﻿" },
  { label: "line-separator", rawText: " " },
  { label: "paragraph-separator", rawText: " " },
  { label: "ideographic-space", rawText: "　" },
  { label: "ogham-space", rawText: " " },
  { label: "en-quad", rawText: " " },
  { label: "narrow-nbsp", rawText: " " },
  { label: "real-text", rawText: "lecture notes" },
  { label: "text-with-padding", rawText: "  lecture notes  " },
  { label: "single-zero", rawText: "0" },
  { label: "text-after-newlines", rawText: "\n\n  x" },
];

let userId: string;
let courseId: string;
const idByLabel = new Map<string, string>();

beforeAll(async () => {
  const user = await seedUser({ role: "INSTRUCTOR" });
  userId = user.id;
  const course = await seedCourse({ isPublished: true });
  courseId = course.id;
  await enroll(courseId, userId, "INSTRUCTOR");

  for (const [index, testCase] of CASES.entries()) {
    const material = await prisma.courseMaterial.create({
      data: {
        courseId,
        title: `indexable-${testCase.label}`,
        mimeType: "text/plain",
        fileSize: 1,
        checksum: `indexable-text-${index}`,
        status: "FAILED",
        uploadedBy: userId,
        rawText: testCase.rawText,
      },
    });
    idByLabel.set(testCase.label, material.id);
  }
});

afterAll(async () => {
  await prisma.courseMaterial.deleteMany({ where: { courseId } });
  await cleanupRbac({ userIds: [userId], courseIds: [courseId] });
});

describe("indexable-text predicates agree against a real database", () => {
  it("returns exactly the rows hasIndexableText accepts", async () => {
    const allIds = CASES.map((testCase) => idByLabel.get(testCase.label)!);

    const fromSql = await selectMaterialIdsWithIndexableText(allIds);
    const fromJs = new Set(
      CASES.filter((testCase) => hasIndexableText(testCase.rawText)).map((testCase) =>
        idByLabel.get(testCase.label)!,
      ),
    );

    // Compared by label so a failure names the shape that drifted rather than
    // printing two sets of cuids.
    const labelsOf = (ids: Set<string>) =>
      CASES.filter((testCase) => ids.has(idByLabel.get(testCase.label)!))
        .map((testCase) => testCase.label)
        .toSorted();

    expect(labelsOf(fromSql)).toEqual(labelsOf(fromJs));
  });

  it("accepts only the shapes that carry a non-space character", async () => {
    const allIds = CASES.map((testCase) => idByLabel.get(testCase.label)!);

    const fromSql = await selectMaterialIdsWithIndexableText(allIds);

    // Pinned independently of `hasIndexableText`, so a regression that breaks
    // both halves the same way still fails here.
    expect(
      CASES.filter((testCase) => fromSql.has(idByLabel.get(testCase.label)!))
        .map((testCase) => testCase.label)
        .toSorted(),
    ).toEqual(["real-text", "single-zero", "text-after-newlines", "text-with-padding"]);
  });
});
