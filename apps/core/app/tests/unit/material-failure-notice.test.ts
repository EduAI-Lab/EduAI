// #1749: a failed upload badge showed no reason and no way to recover — the
// instructor's only option was to re-upload the file and hope. The reason the
// background job recorded never reaches the client (it goes to logSystemError;
// CourseMaterial has no column for it — split out as #1794), so the notice is
// derived from what the row does carry. These tests pin that derivation, and
// in particular pin that "Try again" is only ever offered when it can actually
// work — failMaterial discards the upload blob, so an extraction failure has
// no bytes left to retry from.
import { describe, it, expect } from "vitest";

import {
  describeMaterialFailure,
  describeMaterialRetryFailure,
} from "~/lib/material-failure-notice";

const failedIndexing = {
  status: "FAILED" as const,
  duplicateOfId: null,
  hasExtractedText: true,
};

describe("describeMaterialFailure — nothing to explain", () => {
  it("returns null for a material that is still processing", () => {
    expect(describeMaterialFailure({ ...failedIndexing, status: "PROCESSING" })).toBeNull();
  });

  it("returns null for a material that succeeded", () => {
    expect(describeMaterialFailure({ ...failedIndexing, status: "READY" })).toBeNull();
  });
});

describe("describeMaterialFailure — duplicate receipt", () => {
  const duplicate = {
    status: "FAILED" as const,
    duplicateOfId: "material-winner",
    hasExtractedText: true,
  };

  it("explains that the file is already on the course rather than that it failed", () => {
    const notice = describeMaterialFailure(duplicate);

    expect(notice?.kind).toBe("duplicate");
    expect(notice?.description).toMatch(/already/i);
  });

  it("offers no retry, because re-running would produce the same duplicate", () => {
    expect(describeMaterialFailure(duplicate)?.canRetry).toBe(false);
  });

  it("points at the material that won so the instructor can find it", () => {
    expect(describeMaterialFailure(duplicate)?.duplicateOfId).toBe("material-winner");
  });

  it("takes precedence over the indexing branch even with text extracted", () => {
    // A duplicate receipt always has rawText — it got far enough to checksum
    // the content. Ordering the indexing branch first would mislabel every
    // duplicate as an indexing failure and offer a retry that cannot help.
    expect(describeMaterialFailure({ ...duplicate, hasExtractedText: true })?.kind).toBe(
      "duplicate",
    );
  });
});

describe("describeMaterialFailure — extraction failed", () => {
  const unreadable = {
    status: "FAILED" as const,
    duplicateOfId: null,
    hasExtractedText: false,
  };

  it("says the file could not be read", () => {
    const notice = describeMaterialFailure(unreadable);

    expect(notice?.kind).toBe("unreadable-file");
    expect(notice?.title).toMatch(/could ?n[o']t read/i);
  });

  it("offers no retry, because failMaterial discarded the uploaded bytes", () => {
    expect(describeMaterialFailure(unreadable)?.canRetry).toBe(false);
  });

  it("tells the instructor to re-upload, since that is the only route forward", () => {
    expect(describeMaterialFailure(unreadable)?.description).toMatch(/upload/i);
  });
});

describe("describeMaterialFailure — indexing failed", () => {
  it("distinguishes a text-extracted failure from an unreadable file", () => {
    const notice = describeMaterialFailure(failedIndexing);

    expect(notice?.kind).toBe("indexing-failed");
    expect(notice?.description).toMatch(/text/i);
  });

  it("offers a retry, because the extracted text is still in the database", () => {
    expect(describeMaterialFailure(failedIndexing)?.canRetry).toBe(true);
  });

  it("does not blame the instructor's file for an indexing fault", () => {
    const notice = describeMaterialFailure(failedIndexing);

    expect(notice?.description).not.toMatch(/corrupt|invalid file|unsupported/i);
  });
});

// #1795 review: the retry's rejection had nowhere to go — `handleReprocessMaterial`
// had a `finally` but no `catch`, and the click discarded the promise with
// `void`, so every server-side refusal became an unhandled rejection. The user
// saw "Retrying…" flash and the button come back, with no indication that
// anything had happened, and clicking again reproduced it forever.
describe("describeMaterialRetryFailure", () => {
  it("explains a row that settled between the list read and the click", () => {
    const message = describeMaterialRetryFailure('{"error":"MATERIAL_NOT_FAILED"}');

    expect(message).toMatch(/no longer failed|already/i);
    expect(message).not.toMatch(/MATERIAL_NOT_FAILED/);
  });

  it("explains text that is gone, and points at the one thing that still works", () => {
    const message = describeMaterialRetryFailure('{"error":"MATERIAL_TEXT_UNAVAILABLE"}');

    expect(message).toMatch(/upload/i);
    expect(message).not.toMatch(/MATERIAL_TEXT_UNAVAILABLE/);
  });

  it("explains a duplicate receipt, which retrying cannot change", () => {
    const message = describeMaterialRetryFailure('{"error":"MATERIAL_DUPLICATE"}');

    expect(message).toMatch(/already on (this|the) course/i);
  });

  it("explains a refusal by the permission gate", () => {
    const message = describeMaterialRetryFailure('{"error":"Forbidden"}');

    expect(message).toMatch(/permission/i);
  });

  it("falls back to something an instructor can read, never a raw response body", () => {
    // A 500 or a dropped connection has no code to look up, and the body is
    // whatever the server happened to emit.
    const message = describeMaterialRetryFailure("<html>502 Bad Gateway</html>");

    expect(message).toMatch(/couldn't retry/i);
    expect(message).not.toMatch(/html|502/i);
  });

  it("says something useful when there is no message at all", () => {
    expect(describeMaterialRetryFailure("")).toMatch(/couldn't retry/i);
  });
});
