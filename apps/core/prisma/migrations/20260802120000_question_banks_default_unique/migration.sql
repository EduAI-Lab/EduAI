-- At most one default question bank per course (race-safe ensureDefaultBank).
CREATE UNIQUE INDEX "question_banks_courseId_default_key"
  ON "question_banks"("courseId")
  WHERE "isDefault";
