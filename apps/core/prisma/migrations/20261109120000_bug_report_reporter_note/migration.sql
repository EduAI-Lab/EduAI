-- The admin's status note to a bug reporter, emailed on each save.
ALTER TABLE "bug_reports" ADD COLUMN "reporterNoteSubject" VARCHAR(200);
ALTER TABLE "bug_reports" ADD COLUMN "reporterNote" VARCHAR(5000);
ALTER TABLE "bug_reports" ADD COLUMN "reporterNoteUpdatedAt" TIMESTAMP(3);
ALTER TABLE "bug_reports" ADD COLUMN "reporterNoteEmailedAt" TIMESTAMP(3);
