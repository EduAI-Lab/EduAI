-- CreateTable
CREATE TABLE "canvas_bank_mappings" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "local_bank_id" TEXT NOT NULL,
    "canvas_course_id" INTEGER NOT NULL,
    "canvas_bank_id" INTEGER NOT NULL,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canvas_bank_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canvas_bank_question_mappings" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "local_question_metadata_id" INTEGER NOT NULL,
    "canvas_assessment_question_id" INTEGER NOT NULL,
    "local_bank_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canvas_bank_question_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "canvas_bank_mappings_user_id_canvas_bank_id_key" ON "canvas_bank_mappings"("user_id", "canvas_bank_id");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_bank_question_mappings_user_id_canvas_assessment_que_key" ON "canvas_bank_question_mappings"("user_id", "canvas_assessment_question_id");

-- AddForeignKey
ALTER TABLE "canvas_bank_mappings" ADD CONSTRAINT "canvas_bank_mappings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canvas_bank_question_mappings" ADD CONSTRAINT "canvas_bank_question_mappings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canvas_bank_question_mappings" ADD CONSTRAINT "canvas_bank_question_mappings_local_question_metadata_id_fkey" FOREIGN KEY ("local_question_metadata_id") REFERENCES "question_metadata"("id") ON DELETE CASCADE ON UPDATE CASCADE;