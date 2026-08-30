/**
 * Unit tests for `useOCRHistory` (#1546): localStorage-backed CRUD + query helpers
 * for the OCR job history panel. Covers persistence, pruning, and the query helpers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useOCRHistory } from "@/hooks/use-ocr-history";
import {
  getOCRHistoryStorageKey,
  MAX_HISTORY_ITEMS,
  MAX_STORED_QUESTIONS_PER_JOB,
} from "@/types/ocr";
import type { OCRJob } from "@/types/ocr";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "test-user", name: "Tester", role: "instructor" },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

const STORAGE_KEY = getOCRHistoryStorageKey("test-user")!;

const baseJob: Omit<OCRJob, "id" | "createdAt"> = {
  fileName: "scan.pdf",
  status: "pending",
  courseId: 1,
  courseName: "Course 1",
  model: "vllm:qwen2.5-32b-instruct",
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
});

describe("useOCRHistory", () => {
  it("starts empty and not loading after mount when storage is empty", async () => {
    const { result } = renderHook(() => useOCRHistory());
    expect(result.current.jobs).toEqual([]);
    await act(async () => {});
    expect(result.current.isLoading).toBe(false);
  });

  it("loads jobs already present in localStorage", async () => {
    const stored: OCRJob[] = [
      {
        id: "a",
        createdAt: new Date().toISOString(),
        fileName: "x.pdf",
        status: "success",
        courseId: 1,
      } as OCRJob,
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const { result } = renderHook(() => useOCRHistory());
    await act(async () => {});
    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.jobs[0].id).toBe("a");
  });

  it("resets history when localStorage contains invalid JSON", async () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    const { result } = renderHook(() => useOCRHistory());
    await act(async () => {});
    expect(result.current.jobs).toEqual([]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")).toEqual([]);
  });

  it("ignores a non-array payload in storage", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: "an array" }));
    const { result } = renderHook(() => useOCRHistory());
    await act(async () => {});
    expect(result.current.jobs).toEqual([]);
  });

  it("prunes jobs older than the retention window on load", async () => {
    const old: OCRJob = {
      id: "old",
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 400).toISOString(),
      fileName: "old.pdf",
      status: "success",
      courseId: 1,
    } as OCRJob;
    const recent: OCRJob = {
      id: "recent",
      createdAt: new Date().toISOString(),
      fileName: "new.pdf",
      status: "success",
      courseId: 1,
    } as OCRJob;
    localStorage.setItem(STORAGE_KEY, JSON.stringify([old, recent]));

    const { result } = renderHook(() => useOCRHistory());
    await act(async () => {});
    expect(result.current.jobs.map((j) => j.id)).toEqual(["recent"]);
  });

  it("addJob prepends a new job with a generated id and persists it", async () => {
    const { result } = renderHook(() => useOCRHistory());
    await act(async () => {});

    let newId = "";
    act(() => {
      newId = result.current.addJob(baseJob);
    });

    expect(newId).toMatch(/^ocr-/);
    expect(result.current.jobs[0].id).toBe(newId);
    expect(result.current.jobs[0].fileName).toBe("scan.pdf");

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    expect(stored).toHaveLength(1);
  });

  it("retries with a reduced job list when storage quota is exceeded, and gives up if that still fails", async () => {
    const { result } = renderHook(() => useOCRHistory());
    await act(async () => {});
    act(() => {
      result.current.addJob(baseJob);
      result.current.addJob(baseJob);
    });

    const quotaError = new DOMException("quota", "QuotaExceededError");
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementationOnce(() => {
        throw quotaError;
      })
      .mockImplementationOnce(() => undefined);

    act(() => {
      result.current.addJob(baseJob);
    });
    expect(setItemSpy).toHaveBeenCalledTimes(2);

    setItemSpy.mockImplementation(() => {
      throw quotaError;
    });
    // A second failure (even on the reduced payload) is swallowed, not thrown.
    expect(() => act(() => result.current.addJob(baseJob))).not.toThrow();

    setItemSpy.mockRestore();
  });

  it("addJob caps storedQuestions at MAX_STORED_QUESTIONS_PER_JOB", async () => {
    const { result } = renderHook(() => useOCRHistory());
    await act(async () => {});

    const many = Array.from({ length: MAX_STORED_QUESTIONS_PER_JOB + 10 }, (_, i) => ({
      id: `q${i}`,
    }));
    act(() => {
      result.current.addJob({ ...baseJob, storedQuestions: many as any });
    });

    expect(result.current.jobs[0].storedQuestions).toHaveLength(MAX_STORED_QUESTIONS_PER_JOB);
  });

  it("caps total jobs at MAX_HISTORY_ITEMS", async () => {
    const { result } = renderHook(() => useOCRHistory());
    await act(async () => {});

    act(() => {
      for (let i = 0; i < MAX_HISTORY_ITEMS + 5; i++) {
        result.current.addJob({ ...baseJob, fileName: `f${i}.pdf` });
      }
    });

    expect(result.current.jobs.length).toBeLessThanOrEqual(MAX_HISTORY_ITEMS);
  });

  it("updateJob merges updates and truncates storedQuestions", async () => {
    const { result } = renderHook(() => useOCRHistory());
    await act(async () => {});

    let id = "";
    act(() => {
      id = result.current.addJob(baseJob);
    });

    act(() => {
      result.current.updateJob(id, { fileName: "renamed.pdf" });
    });
    expect(result.current.jobs[0].fileName).toBe("renamed.pdf");

    const many = Array.from({ length: MAX_STORED_QUESTIONS_PER_JOB + 3 }, (_, i) => ({
      id: `q${i}`,
    }));
    act(() => {
      result.current.updateJob(id, { storedQuestions: many as any });
    });
    expect(result.current.jobs[0].storedQuestions).toHaveLength(MAX_STORED_QUESTIONS_PER_JOB);
  });

  it("updateJobStatus sets completedAt for terminal statuses and applies extras", async () => {
    const { result } = renderHook(() => useOCRHistory());
    await act(async () => {});

    let id = "";
    act(() => {
      id = result.current.addJob(baseJob);
    });

    act(() => {
      result.current.updateJobStatus(id, "success", { questionsCount: 3 });
    });

    const job = result.current.jobs[0];
    expect(job.status).toBe("success");
    expect(job.questionsCount).toBe(3);
    expect(job.completedAt).toBeTruthy();
  });

  it("updateJobStatus applies error extras without setting completedAt for non-terminal status", async () => {
    const { result } = renderHook(() => useOCRHistory());
    await act(async () => {});

    let id = "";
    act(() => {
      id = result.current.addJob(baseJob);
    });

    act(() => {
      result.current.updateJobStatus(id, "processing");
    });
    expect(result.current.jobs[0].completedAt).toBeUndefined();

    act(() => {
      result.current.updateJobStatus(id, "error", { error: "boom" });
    });
    expect(result.current.jobs[0].status).toBe("error");
    expect(result.current.jobs[0].error).toBe("boom");
    expect(result.current.jobs[0].completedAt).toBeTruthy();
  });

  it("removeJob removes only the targeted job", async () => {
    const { result } = renderHook(() => useOCRHistory());
    await act(async () => {});

    let id1 = "";
    let id2 = "";
    act(() => {
      id1 = result.current.addJob({ ...baseJob, fileName: "one.pdf" });
    });
    act(() => {
      id2 = result.current.addJob({ ...baseJob, fileName: "two.pdf" });
    });

    act(() => {
      result.current.removeJob(id1);
    });

    expect(result.current.jobs.map((j) => j.id)).toEqual([id2]);
  });

  it("clearHistory empties jobs and localStorage", async () => {
    const { result } = renderHook(() => useOCRHistory());
    await act(async () => {});

    act(() => {
      result.current.addJob(baseJob);
    });
    expect(result.current.jobs).toHaveLength(1);

    act(() => {
      result.current.clearHistory();
    });
    expect(result.current.jobs).toEqual([]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")).toEqual([]);
  });

  it("getJobsByStatus filters by a single status or an array of statuses", async () => {
    const { result } = renderHook(() => useOCRHistory());
    await act(async () => {});

    act(() => {
      result.current.addJob({ ...baseJob, status: "success" });
      result.current.addJob({ ...baseJob, status: "error" });
      result.current.addJob({ ...baseJob, status: "pending" });
    });

    expect(result.current.getJobsByStatus("success")).toHaveLength(1);
    expect(result.current.getJobsByStatus(["success", "error"])).toHaveLength(2);
  });

  it("getJobsByCourse filters by courseId and getJob finds by id", async () => {
    const { result } = renderHook(() => useOCRHistory());
    await act(async () => {});

    let id = "";
    act(() => {
      id = result.current.addJob({ ...baseJob, courseId: 42 });
      result.current.addJob({ ...baseJob, courseId: 7 });
    });

    expect(result.current.getJobsByCourse(42)).toHaveLength(1);
    expect(result.current.getJob(id)?.courseId).toBe(42);
    expect(result.current.getJob("missing")).toBeUndefined();
  });

  it("reloads jobs on a matching storage event from another tab", async () => {
    const { result } = renderHook(() => useOCRHistory());
    await act(async () => {});

    const externalJob: OCRJob = {
      id: "ext",
      createdAt: new Date().toISOString(),
      fileName: "external.pdf",
      status: "success",
      courseId: 1,
    } as OCRJob;
    localStorage.setItem(STORAGE_KEY, JSON.stringify([externalJob]));

    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    });

    expect(result.current.jobs.map((j) => j.id)).toEqual(["ext"]);
  });

  it("ignores storage events for unrelated keys", async () => {
    const { result } = renderHook(() => useOCRHistory());
    await act(async () => {});

    act(() => {
      result.current.addJob(baseJob);
    });
    const before = result.current.jobs;

    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", { key: "unrelated-key" }));
    });

    expect(result.current.jobs).toBe(before);
  });
});
