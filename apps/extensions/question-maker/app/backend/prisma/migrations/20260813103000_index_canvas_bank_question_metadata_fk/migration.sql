-- Index the Canvas bank question → QuestionMetadata FK (#845 / #1368 audit).
CREATE INDEX "canvas_bank_question_mappings_local_question_metadata_id_idx"
  ON "canvas_bank_question_mappings"("local_question_metadata_id");
