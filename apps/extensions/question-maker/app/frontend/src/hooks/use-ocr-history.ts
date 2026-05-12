import { useState, useEffect, useCallback } from 'react';
import type {
  OCRJob,
  OCRJobStatus,
  StoredQuestion,
} from '../types/ocr';
import {
  OCR_HISTORY_KEY,
  MAX_HISTORY_ITEMS,
  HISTORY_RETENTION_DAYS,
  MAX_STORED_QUESTIONS_PER_JOB,
} from '../types/ocr';

export interface UseOCRHistoryReturn {
  jobs: OCRJob[];
  isLoading: boolean;
  addJob: (job: Omit<OCRJob, 'id' | 'createdAt'>) => string;
  updateJob: (id: string, updates: Partial<OCRJob>) => void;
  updateJobStatus: (
    id: string,
    status: OCRJobStatus,
    extras?: { error?: string; questionsCount?: number; storedQuestions?: StoredQuestion[] }
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

const loadFromStorage = (): OCRJob[] => {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(OCR_HISTORY_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as OCRJob[];
    if (!Array.isArray(parsed)) return [];
    return pruneOldJobs(parsed);
  } catch (error) {
    console.warn('[useOCRHistory] Failed to parse localStorage, resetting history:', error);
    localStorage.removeItem(OCR_HISTORY_KEY);
    return [];
  }
};

const saveToStorage = (jobs: OCRJob[]): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const limitedJobs = jobs.slice(0, MAX_HISTORY_ITEMS);
    localStorage.setItem(OCR_HISTORY_KEY, JSON.stringify(limitedJobs));
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      const reducedJobs = jobs.slice(0, Math.floor(jobs.length / 2));
      try {
        localStorage.setItem(OCR_HISTORY_KEY, JSON.stringify(reducedJobs));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
};

export function useOCRHistory(): UseOCRHistoryReturn {
  const [jobs, setJobs] = useState<OCRJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setJobs(loadFromStorage());
    setIsLoading(false);
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === OCR_HISTORY_KEY) setJobs(loadFromStorage());
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  useEffect(() => {
    if (!isLoading) saveToStorage(jobs);
  }, [jobs, isLoading]);

  const addJob = useCallback((jobData: Omit<OCRJob, 'id' | 'createdAt'>): string => {
    const id = generateId();
    const newJob: OCRJob = {
      ...jobData,
      id,
      createdAt: new Date().toISOString(),
      storedQuestions: jobData.storedQuestions?.slice(0, MAX_STORED_QUESTIONS_PER_JOB),
    };
    setJobs((prev) => [newJob, ...prev].slice(0, MAX_HISTORY_ITEMS));
    return id;
  }, []);

  const updateJob = useCallback((id: string, updates: Partial<OCRJob>) => {
    setJobs((prev) =>
      prev.map((job) => {
        if (job.id !== id) return job;
        return {
          ...job,
          ...updates,
          storedQuestions: updates.storedQuestions
            ? updates.storedQuestions.slice(0, MAX_STORED_QUESTIONS_PER_JOB)
            : job.storedQuestions,
        };
      })
    );
  }, []);

  const updateJobStatus = useCallback(
    (
      id: string,
      status: OCRJobStatus,
      extras?: { error?: string; questionsCount?: number; storedQuestions?: StoredQuestion[] }
    ) => {
      setJobs((prev) =>
        prev.map((job) => {
          if (job.id !== id) return job;
          return {
            ...job,
            status,
            ...(status === 'success' || status === 'error' || status === 'discarded'
              ? { completedAt: new Date().toISOString() }
              : {}),
            ...(extras?.error ? { error: extras.error } : {}),
            ...(extras?.questionsCount !== undefined ? { questionsCount: extras.questionsCount } : {}),
            ...(extras?.storedQuestions
              ? { storedQuestions: extras.storedQuestions.slice(0, MAX_STORED_QUESTIONS_PER_JOB) }
              : {}),
          };
        })
      );
    },
    []
  );

  const removeJob = useCallback((id: string) => {
    setJobs((prev) => prev.filter((job) => job.id !== id));
  }, []);

  const clearHistory = useCallback(() => {
    setJobs([]);
    localStorage.removeItem(OCR_HISTORY_KEY);
  }, []);

  const getJobsByStatus = useCallback(
    (status: OCRJobStatus | OCRJobStatus[]): OCRJob[] => {
      const statuses = Array.isArray(status) ? status : [status];
      return jobs.filter((job) => statuses.includes(job.status));
    },
    [jobs]
  );

  const getJobsByCourse = useCallback(
    (courseId: number) => jobs.filter((job) => job.courseId === courseId),
    [jobs]
  );

  const getJob = useCallback(
    (id: string) => jobs.find((job) => job.id === id),
    [jobs]
  );

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
