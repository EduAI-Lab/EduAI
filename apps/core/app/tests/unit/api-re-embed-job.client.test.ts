// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchReEmbedJob,
  formatReEmbedJobMessage,
  isReEmbedJobTerminal,
  pollReEmbedJobUntilDone,
  type ReEmbedJobResponse,
} from "~/lib/api/re-embed-job.client";

const baseJob: ReEmbedJobResponse = {
  id: "job-1",
  courseId: "course-1",
  status: "PENDING",
  totalMaterials: 3,
  processedCount: 0,
  failed: [],
  currentMaterialTitle: null,
  errorMessage: null,
};

describe("isReEmbedJobTerminal", () => {
  it("treats COMPLETED, PARTIAL, and FAILED as terminal", () => {
    expect(isReEmbedJobTerminal("COMPLETED")).toBe(true);
    expect(isReEmbedJobTerminal("PARTIAL")).toBe(true);
    expect(isReEmbedJobTerminal("FAILED")).toBe(true);
  });

  it("treats PENDING and RUNNING as non-terminal", () => {
    expect(isReEmbedJobTerminal("PENDING")).toBe(false);
    expect(isReEmbedJobTerminal("RUNNING")).toBe(false);
  });
});

describe("formatReEmbedJobMessage", () => {
  it("reports a failure message, or a fallback when none is set", () => {
    expect(formatReEmbedJobMessage({ ...baseJob, status: "FAILED", errorMessage: "boom" })).toBe(
      "boom",
    );
    expect(formatReEmbedJobMessage({ ...baseJob, status: "FAILED", errorMessage: null })).toBe(
      "Processing failed.",
    );
  });

  it("reports a completed count", () => {
    expect(
      formatReEmbedJobMessage({ ...baseJob, status: "COMPLETED", processedCount: 3 }),
    ).toBe("Processed 3 material(s).");
  });

  it("reports a partial result with failures", () => {
    expect(
      formatReEmbedJobMessage({
        ...baseJob,
        status: "PARTIAL",
        processedCount: 2,
        totalMaterials: 3,
        failed: ["material-a"],
      }),
    ).toBe("Processed 2 of 3 material(s); 1 failed.");
  });

  it("reports a partial result without failures", () => {
    expect(
      formatReEmbedJobMessage({ ...baseJob, status: "PARTIAL", processedCount: 2, totalMaterials: 3 }),
    ).toBe("Processed 2 of 3 material(s).");
  });

  it("reports a generic in-progress message otherwise", () => {
    expect(formatReEmbedJobMessage({ ...baseJob, status: "PENDING" })).toBe("Processing…");
    expect(formatReEmbedJobMessage({ ...baseJob, status: "RUNNING" })).toBe("Processing…");
  });
});

describe("fetchReEmbedJob", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns the job on a successful response", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ job: baseJob }), { status: 200 }),
    ) as never;

    const job = await fetchReEmbedJob("course-1", "job-1");
    expect(job).toEqual(baseJob);
    expect(global.fetch).toHaveBeenCalledWith("/api/courses/course-1/re-embed/job-1");
  });

  it("throws when the response body cannot be parsed", async () => {
    global.fetch = vi.fn(async () => new Response("not json", { status: 200 })) as never;

    await expect(fetchReEmbedJob("course-1", "job-1")).rejects.toThrow(
      "Server returned invalid JSON",
    );
  });

  it("throws the server's error message on a non-ok response", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "Job not found" }), { status: 404 }),
    ) as never;

    await expect(fetchReEmbedJob("course-1", "job-1")).rejects.toThrow("Job not found");
  });

  it("throws a fallback message on a non-ok response with no error field", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 500 })) as never;

    await expect(fetchReEmbedJob("course-1", "job-1")).rejects.toThrow(
      "Failed to load processing status",
    );
  });
});

describe("pollReEmbedJobUntilDone", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("polls until the job reaches a terminal status, calling onUpdate along the way", async () => {
    const responses: ReEmbedJobResponse[] = [
      { ...baseJob, status: "PENDING" },
      { ...baseJob, status: "RUNNING" },
      { ...baseJob, status: "COMPLETED", processedCount: 3 },
    ];
    let call = 0;
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ job: responses[call++] }), { status: 200 }),
    ) as never;

    const onUpdate = vi.fn();
    const result = await pollReEmbedJobUntilDone("course-1", "job-1", {
      intervalMs: 1,
      onUpdate,
    });

    expect(result.status).toBe("COMPLETED");
    expect(onUpdate).toHaveBeenCalledTimes(3);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});
