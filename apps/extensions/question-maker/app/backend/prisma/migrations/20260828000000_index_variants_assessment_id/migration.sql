-- `variants.assessment_id` is a foreign key with no index. The section-delete orphan sweep
-- (#1371) filters on it directly, so without this it degrades to a sequential scan over the
-- whole question bank. Not CONCURRENTLY: Prisma runs migrations inside a transaction.
CREATE INDEX "variants_assessment_id_idx" ON "variants"("assessment_id");
