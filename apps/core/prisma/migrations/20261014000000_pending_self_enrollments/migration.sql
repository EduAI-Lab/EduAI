-- CreateTable
CREATE TABLE "pending_self_enrollments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "outcome" TEXT,

    CONSTRAINT "pending_self_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_self_enrollments_linkId_idx" ON "pending_self_enrollments"("linkId");

-- CreateIndex
CREATE UNIQUE INDEX "pending_self_enrollments_userId_linkId_key" ON "pending_self_enrollments"("userId", "linkId");

-- AddForeignKey
ALTER TABLE "pending_self_enrollments" ADD CONSTRAINT "pending_self_enrollments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_self_enrollments" ADD CONSTRAINT "pending_self_enrollments_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "self_enrollment_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
