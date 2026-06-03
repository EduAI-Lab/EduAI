-- Async re-index jobs for course materials (see re-embed-job.server.ts).

CREATE TYPE "ReEmbedJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

CREATE TABLE "course_re_embed_jobs" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "status" "ReEmbedJobStatus" NOT NULL DEFAULT 'PENDING',
    "totalMaterials" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "failedMaterialIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "currentMaterialTitle" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_re_embed_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "course_re_embed_jobs_courseId_status_idx" ON "course_re_embed_jobs"("courseId", "status");

ALTER TABLE "course_re_embed_jobs" ADD CONSTRAINT "course_re_embed_jobs_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
