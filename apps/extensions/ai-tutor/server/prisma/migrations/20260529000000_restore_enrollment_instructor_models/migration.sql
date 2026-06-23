-- Restore CourseInstructor and CourseEnrollment models removed during schema_unification.
-- userId is stored as a plain string (Core CUID); no FK to a local User table.

CREATE TABLE IF NOT EXISTS "public"."CourseInstructor" (
    "userId" TEXT NOT NULL,
    "courseOfferingId" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'LEAD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseInstructor_pkey" PRIMARY KEY ("userId", "courseOfferingId"),
    CONSTRAINT "CourseInstructor_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "public"."CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "public"."CourseEnrollment" (
    "userId" TEXT NOT NULL,
    "courseOfferingId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseEnrollment_pkey" PRIMARY KEY ("courseOfferingId", "userId"),
    CONSTRAINT "CourseEnrollment_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "public"."CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
