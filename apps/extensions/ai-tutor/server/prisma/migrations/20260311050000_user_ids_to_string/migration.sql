ALTER TABLE "CourseInstructor" DROP CONSTRAINT "CourseInstructor_userId_fkey";
ALTER TABLE "CourseEnrollment" DROP CONSTRAINT "CourseEnrollment_userId_fkey";
ALTER TABLE "Submission" DROP CONSTRAINT "Submission_userId_fkey";
ALTER TABLE "ActivityFeedback" DROP CONSTRAINT "ActivityFeedback_userId_fkey";
ALTER TABLE "ActivityStudentMetric" DROP CONSTRAINT "ActivityStudentMetric_userId_fkey";
ALTER TABLE "AiChatSession" DROP CONSTRAINT "AiChatSession_userId_fkey";
ALTER TABLE "AiInteractionTrace" DROP CONSTRAINT "AiInteractionTrace_userId_fkey";
ALTER TABLE "Session" DROP CONSTRAINT "Session_userId_fkey";
ALTER TABLE "Account" DROP CONSTRAINT "Account_userId_fkey";

ALTER TABLE "User" ALTER COLUMN "id" DROP DEFAULT;

ALTER TABLE "User"
  ALTER COLUMN "id" TYPE TEXT USING "id"::text;

ALTER TABLE "CourseInstructor"
  ALTER COLUMN "userId" TYPE TEXT USING "userId"::text;

ALTER TABLE "CourseEnrollment"
  ALTER COLUMN "userId" TYPE TEXT USING "userId"::text;

ALTER TABLE "Submission"
  ALTER COLUMN "userId" TYPE TEXT USING "userId"::text;

ALTER TABLE "ActivityFeedback"
  ALTER COLUMN "userId" TYPE TEXT USING "userId"::text;

ALTER TABLE "ActivityStudentMetric"
  ALTER COLUMN "userId" TYPE TEXT USING "userId"::text;

ALTER TABLE "AiChatSession"
  ALTER COLUMN "userId" TYPE TEXT USING "userId"::text;

ALTER TABLE "AiInteractionTrace"
  ALTER COLUMN "userId" TYPE TEXT USING "userId"::text;

ALTER TABLE "Session"
  ALTER COLUMN "userId" TYPE TEXT USING "userId"::text;

ALTER TABLE "Account"
  ALTER COLUMN "userId" TYPE TEXT USING "userId"::text;

ALTER TABLE "CourseInstructor"
  ADD CONSTRAINT "CourseInstructor_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseEnrollment"
  ADD CONSTRAINT "CourseEnrollment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActivityFeedback"
  ADD CONSTRAINT "ActivityFeedback_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActivityStudentMetric"
  ADD CONSTRAINT "ActivityStudentMetric_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiChatSession"
  ADD CONSTRAINT "AiChatSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiInteractionTrace"
  ADD CONSTRAINT "AiInteractionTrace_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Session"
  ADD CONSTRAINT "Session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Account"
  ADD CONSTRAINT "Account_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
