-- CreateTable
CREATE TABLE "self_enrollment_links" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "maxRedemptions" INTEGER,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "self_enrollment_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "self_enrollment_links_tokenHash_key" ON "self_enrollment_links"("tokenHash");

-- CreateIndex
CREATE INDEX "self_enrollment_links_courseId_idx" ON "self_enrollment_links"("courseId");

-- CreateIndex
CREATE INDEX "self_enrollment_links_createdById_idx" ON "self_enrollment_links"("createdById");

-- AddForeignKey
ALTER TABLE "self_enrollment_links" ADD CONSTRAINT "self_enrollment_links_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "self_enrollment_links" ADD CONSTRAINT "self_enrollment_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
