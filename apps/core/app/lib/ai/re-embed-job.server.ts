import prisma from "../prisma.server";
import { reEmbedCourseMaterials, type ReEmbedProgress } from "./embedding";
import { resolveReEmbedJobStatus } from "./re-embed-job-status";
import type { ReEmbedJobStatus } from "@prisma/client";

export { resolveReEmbedJobStatus } from "./re-embed-job-status";

export type ReEmbedJobSnapshot = {
  id: string;
  courseId: string;
  status: ReEmbedJobStatus;
  totalMaterials: number;
  processedCount: number;
  failedMaterialIds: string[];
  currentMaterialTitle: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toSnapshot(job: ReEmbedJobSnapshot): ReEmbedJobSnapshot {
  return job;
}

export function serializeReEmbedJob(job: ReEmbedJobSnapshot) {
  return {
    id: job.id,
    courseId: job.courseId,
    status: job.status,
    totalMaterials: job.totalMaterials,
    processedCount: job.processedCount,
    failed: job.failedMaterialIds,
    currentMaterialTitle: job.currentMaterialTitle,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

const ACTIVE_JOB_STATUSES: ReEmbedJobStatus[] = ["PENDING", "RUNNING"];

export async function findActiveReEmbedJob(
  courseId: string,
): Promise<ReEmbedJobSnapshot | null> {
  const job = await prisma.courseReEmbedJob.findFirst({
    where: { courseId, status: { in: ACTIVE_JOB_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  return job ? toSnapshot(job) : null;
}

export async function getReEmbedJobForCourse(
  courseId: string,
  jobId: string,
): Promise<ReEmbedJobSnapshot | null> {
  const job = await prisma.courseReEmbedJob.findFirst({
    where: { id: jobId, courseId },
  });
  return job ? toSnapshot(job) : null;
}

async function updateJobProgress(jobId: string, progress: ReEmbedProgress): Promise<void> {
  await prisma.courseReEmbedJob.update({
    where: { id: jobId },
    data: {
      totalMaterials: progress.total,
      processedCount: progress.processed,
      failedMaterialIds: progress.failed,
      currentMaterialTitle: progress.currentMaterialTitle ?? null,
    },
  });
}

async function runReEmbedJob(jobId: string, courseId: string): Promise<void> {
  try {
    await prisma.courseReEmbedJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: new Date(), errorMessage: null },
    });

    const result = await reEmbedCourseMaterials(courseId, {
      onProgress: (progress) => updateJobProgress(jobId, progress),
    });

    const status = resolveReEmbedJobStatus(result);

    await prisma.courseReEmbedJob.update({
      where: { id: jobId },
      data: {
        status,
        totalMaterials: result.total,
        processedCount: result.processed,
        failedMaterialIds: result.failed,
        currentMaterialTitle: null,
        completedAt: new Date(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[re-embed-job] job failed", { jobId, courseId, error: message });
    await prisma.courseReEmbedJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        errorMessage: message,
        currentMaterialTitle: null,
        completedAt: new Date(),
      },
    });
  }
}

/**
 * Create a background re-embed job and start processing without blocking the caller.
 */
export async function startReEmbedJob(courseId: string): Promise<ReEmbedJobSnapshot> {
  const active = await findActiveReEmbedJob(courseId);
  if (active) {
    return active;
  }

  const job = await prisma.courseReEmbedJob.create({
    data: { courseId, status: "PENDING" },
  });

  void runReEmbedJob(job.id, courseId);

  return toSnapshot(job);
}
