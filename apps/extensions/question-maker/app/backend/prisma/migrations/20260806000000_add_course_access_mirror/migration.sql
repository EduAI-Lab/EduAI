-- CreateTable
CREATE TABLE "course_access" (
    "id" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_id" INTEGER NOT NULL,
    "enrollment_role" TEXT NOT NULL,
    "department" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_access_user_id_course_id_key" ON "course_access"("user_id", "course_id");
CREATE INDEX "course_access_user_id_enrollment_role_idx" ON "course_access"("user_id", "enrollment_role");
CREATE INDEX "course_access_user_id_department_idx" ON "course_access"("user_id", "department");

-- AddForeignKey
ALTER TABLE "course_access" ADD CONSTRAINT "course_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "course_access" ADD CONSTRAINT "course_access_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
