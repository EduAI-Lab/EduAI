import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../contexts/AuthContext";
import type { OCRJob, OCRJobStatus, StoredQuestion } from "../types/ocr";
import {
  OCR_HISTORY_KEY,
  OCR_HISTORY_CLEARED_EVENT,
  getOCRHistoryStorageKey,
  MAX_HISTORY_ITEMS,
  HISTORY_RETENTION_DAYS,
  MAX_STORED_QUESTIONS_PER_JOB,
} from "../types/ocr";

export interface UseOCRHistoryReturn {
  jobs: OCRJob[];
  isLoading: boolean;
  addJob: (job: Omit<OCRJob, "id" | "createdAt">) => string;
  updateJob: (id: string, updates: Partial<OCRJob>) => void;
  updateJobStatus: (
    id: string,
    status: OCRJobStatus,
    extras?: { error?: string; questionsCount?: number; storedQuestions?: StoredQuestion[] },
  ) => void;
  removeJob: (id: string) => void;
  clearHistory: () => void;
  getJobsByStatus: (status: OCRJobStatus | OCRJobStatus[]) => OCRJob[];
  getJobsByCourse: (courseId: number) => OCRJob[];
  getJob: (id: string) => OCRJob | undefined;
}

const generateId = () => `ocr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const pruneOldJobs = (jobs: OCRJob[]): OCRJob[] => {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - HISTORY_RETENTION_DAYS);
  const cutoffTime = cutoffDate.getTime();
  return jobs.filter((job) => new Date(job.createdAt).getTime() > cutoffTime);
};

const loadFromStorage = (storageKey: string | null): OCRJob[] => {
  if (typeof window === "undefined" || !storageKey) return [];
  try {
    // Never assign a legacy global history to whichever account happens to sign in next.
    localStorage.removeItem(OCR_HISTORY_KEY);
    const stored = localStorage.getItem(storageKey);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as OCRJob[];
    if (!Array.isArray(parsed)) return [];
    return pruneOldJobs(parsed);
  } catch (error) {
    console.warn("[useOCRHistory] Failed to parse localStorage, resetting history:", error);
    localStorage.removeItem(storageKey);
    return [];
  }
};

const saveToStorage = (storageKey: string | null, jobs: OCRJob[]): boolean => {
  if (typeof window === "undefined" || !storageKey) return false;
  try {
    const limitedJobs = jobs.slice(0, MAX_HISTORY_ITEMS);
    if (limitedJobs.length === 0) {
      localStorage.removeItem(storageKey);
    } else {
      localStorage.setItem(storageKey, JSON.stringify(limitedJobs));
    }
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "QuotaExceededError") {
      const reducedJobs = jobs.slice(0, Math.floor(jobs.length / 2));
      try {
        localStorage.setItem(storageKey, JSON.stringify(reducedJobs));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
};

export function useOCRHistory(): UseOCRHistoryReturn {
  const { user } = useAuth();
  const storageKey = getOCRHistoryStorageKey(user?.id);
  const [history, setHistory] = useState<{
    storageKey: string | null;
    jobs: OCRJob[];
    isLoading: boolean;
  }>({ storageKey: null, jobs: [], isLoading: true });

  // Do not expose the previous account's state even for the render before the
  // account-change effect has loaded the new namespace.
  const isCurrentAccount = history.storageKey === storageKey;
  const jobs = isCurrentAccount ? history.jobs : [];
  const isLoading = !isCurrentAccount || history.isLoading;

  useEffect(() => {
    setHistory({ storageKey, jobs: loadFromStorage(storageKey), isLoading: false });
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === storageKey) {
        setHistory({ storageKey, jobs: loadFromStorage(storageKey), isLoading: false });
      }
    };
    const handleHistoryCleared = (event: Event) => {
      const clearedUserId = (event as CustomEvent<{ userId?: string }>).detail?.userId;
      if (clearedUserId === user?.id) {
        setHistory({ storageKey, jobs: [], isLoading: false });
      }
    };
    window.addEventListener("storage", handleStorageChange);
    window.addEventListener(OCR_HISTORY_CLEARED_EVENT, handleHistoryCleared);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener(OCR_HISTORY_CLEARED_EVENT, handleHistoryCleared);
    };
  }, [storageKey, user?.id]);

  useEffect(() => {
    if (history.storageKey === storageKey && !history.isLoading) {
      saveToStorage(storageKey, history.jobs);
    }
  }, [history, storageKey]);

  const addJob = useCallback(
    (jobData: Omit<OCRJob, "id" | "createdAt">): string => {
      const id = generateId();
      const newJob: OCRJob = {
        ...jobData,
        id,
        createdAt: new Date().toISOString(),
        storedQuestions: jobData.storedQuestions?.slice(0, MAX_STORED_QUESTIONS_PER_JOB),
      };
      setHistory((previous) =>
        previous.storageKey === storageKey
          ? { ...previous, jobs: [newJob, ...previous.jobs].slice(0, MAX_HISTORY_ITEMS) }
          : previous,
      );
      return id;
    },
    [storageKey],
  );

  const updateJob = useCallback(
    (id: string, updates: Partial<OCRJob>) => {
      setHistory((previous) =>
        previous.storageKey === storageKey
          ? {
              ...previous,
              jobs: previous.jobs.map((job) => {
                if (job.id !== id) return job;
                return {
                  ...job,
                  ...updates,
                  storedQuestions: updates.storedQuestions
                    ? updates.storedQuestions.slice(0, MAX_STORED_QUESTIONS_PER_JOB)
                    : job.storedQuestions,
                };
              }),
            }
          : previous,
      );
    },
    [storageKey],
  );

  const updateJobStatus = useCallback(
    (
      id: string,
      status: OCRJobStatus,
      extras?: { error?: string; questionsCount?: number; storedQuestions?: StoredQuestion[] },
    ) => {
      setHistory((previous) =>
        previous.storageKey === storageKey
          ? {
              ...previous,
              jobs: previous.jobs.map((job) => {
                if (job.id !== id) return job;
                const next = { ...job, status };
                // A terminal status stamps the completion time; a running job
                // keeps whatever it already had.
                if (status === "success" || status === "error" || status === "discarded") {
                  next.completedAt = new Date().toISOString();
                }
                if (extras?.error) next.error = extras.error;
                if (extras?.questionsCount !== undefined) {
                  next.questionsCount = extras.questionsCount;
                }
                if (extras?.storedQuestions) {
                  next.storedQuestions = extras.storedQuestions.slice(
                    0,
                    MAX_STORED_QUESTIONS_PER_JOB,
                  );
                }
                return next;
              }),
            }
          : previous,
      );
    },
    [storageKey],
  );

  const removeJob = useCallback(
    (id: string) => {
      setHistory((previous) =>
        previous.storageKey === storageKey
          ? { ...previous, jobs: previous.jobs.filter((job) => job.id !== id) }
          : previous,
      );
    },
    [storageKey],
  );

  const clearHistory = useCallback(() => {
    setHistory((previous) =>
      previous.storageKey === storageKey ? { ...previous, jobs: [] } : previous,
    );
    if (storageKey) localStorage.removeItem(storageKey);
    localStorage.removeItem(OCR_HISTORY_KEY);
  }, [storageKey]);

  const getJobsByStatus = useCallback(
    (status: OCRJobStatus | OCRJobStatus[]): OCRJob[] => {
      const statuses = Array.isArray(status) ? status : [status];
      return jobs.filter((job) => statuses.includes(job.status));
    },
    [jobs],
  );

  const getJobsByCourse = useCallback(
    (courseId: number) => jobs.filter((job) => job.courseId === courseId),
    [jobs],
  );

  const getJob = useCallback((id: string) => jobs.find((job) => job.id === id), [jobs]);

  return {
    jobs,
    isLoading,
    addJob,
    updateJob,
    updateJobStatus,
    removeJob,
    clearHistory,
    getJobsByStatus,
    getJobsByCourse,
    getJob,
  };
}
