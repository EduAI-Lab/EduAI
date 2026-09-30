// @vitest-environment node
/**
 * #1749: the FAILED popover on the manager list decides its copy — and whether
 * it offers **Try again** — from `duplicateOfId` and `hasExtractedText`. The
 * route maps the materials-list rows into the list's own shape, and that map
 * is where both fields were being dropped: every FAILED row then matched the
 * unreadable-file branch, the one outcome with no recovery.
 *
 * These assert the mapping carries both through, per failure kind.
 */
import { describe, it, expect } from "vitest";
import { toUploadMaterial } from "~/routes/courses.$courseId";
import type { CourseMaterial as CourseMaterialRow } from "~/hooks/api/use-course-materials";

function row(overrides: Partial<CourseMaterialRow> = {}): CourseMaterialRow {
  return {
    id: "material-1",
    title: "Week 1 Notes",
    mimeType: "application/pdf",
    fileSize: 1024,
    status: "READY",
    createdAt: "2026-09-01T00:00:00.000Z",
    chunkCount: 3,
    ...overrides,
  } as CourseMaterialRow;
}

describe("toUploadMaterial (#1749)", () => {
  it("carries duplicateOfId through so a duplicate receipt is not shown as unreadable", () => {
    const mapped = toUploadMaterial(
      row({ status: "FAILED", duplicateOfId: "winner-9", hasExtractedText: true }),
    );

    expect(mapped.duplicateOfId).toBe("winner-9");
    expect(mapped.hasExtractedText).toBe(true);
  });

  it("carries hasExtractedText through so an indexing failure stays retryable", () => {
    const mapped = toUploadMaterial(
      row({ status: "FAILED", duplicateOfId: null, hasExtractedText: true }),
    );

    expect(mapped.hasExtractedText).toBe(true);
    expect(mapped.duplicateOfId).toBeNull();
  });

  it("keeps an extraction failure non-retryable: no duplicate, no surviving text", () => {
    const mapped = toUploadMaterial(
      row({ status: "FAILED", duplicateOfId: null, hasExtractedText: false }),
    );

    expect(mapped.hasExtractedText).toBe(false);
    expect(mapped.duplicateOfId).toBeNull();
  });

  it("normalises a row that omits both fields (the list only resolves them for FAILED)", () => {
    const mapped = toUploadMaterial(row({ status: "READY" }));

    // duplicateOfId is normalised to null; hasExtractedText stays undefined so
    // the manager view's own `?? false` remains the single default.
    expect(mapped.duplicateOfId).toBeNull();
    expect(mapped.hasExtractedText).toBeUndefined();
  });

  it("still maps the fields the list already drew", () => {
    const mapped = toUploadMaterial(
      row({ uploadedBy: "user-7", visibleToStudents: false, availableAt: null }),
    );

    expect(mapped).toMatchObject({
      id: "material-1",
      title: "Week 1 Notes",
      mimeType: "application/pdf",
      fileSize: 1024,
      status: "READY",
      chunkCount: 3,
      uploadedBy: "user-7",
      visibleToStudents: false,
      availableAt: null,
    });
  });
});
