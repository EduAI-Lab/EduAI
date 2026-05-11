CREATE TABLE "BugReport" (
  "id" TEXT NOT NULL,
  "description" VARCHAR(2000) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'unhandled',
  "consoleLogs" TEXT,
  "networkLogs" TEXT,
  "screenshot" TEXT,
  "pageUrl" TEXT,
  "userAgent" TEXT,
  "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
  "userId" TEXT NOT NULL,
  "courseOfferingId" INTEGER,
  "moduleId" INTEGER,
  "lessonId" INTEGER,
  "activityId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BugReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BugReport_status_createdAt_idx" ON "BugReport"("status", "createdAt");
CREATE INDEX "BugReport_userId_idx" ON "BugReport"("userId");
CREATE INDEX "BugReport_courseOfferingId_idx" ON "BugReport"("courseOfferingId");
CREATE INDEX "BugReport_moduleId_idx" ON "BugReport"("moduleId");
CREATE INDEX "BugReport_lessonId_idx" ON "BugReport"("lessonId");
CREATE INDEX "BugReport_activityId_idx" ON "BugReport"("activityId");

ALTER TABLE "BugReport"
  ADD CONSTRAINT "BugReport_userId_fkey"
  FOREIGN KEY ("userId")
  REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BugReport"
  ADD CONSTRAINT "BugReport_courseOfferingId_fkey"
  FOREIGN KEY ("courseOfferingId")
  REFERENCES "CourseOffering"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BugReport"
  ADD CONSTRAINT "BugReport_moduleId_fkey"
  FOREIGN KEY ("moduleId")
  REFERENCES "Module"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BugReport"
  ADD CONSTRAINT "BugReport_lessonId_fkey"
  FOREIGN KEY ("lessonId")
  REFERENCES "Lesson"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BugReport"
  ADD CONSTRAINT "BugReport_activityId_fkey"
  FOREIGN KEY ("activityId")
  REFERENCES "Activity"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
