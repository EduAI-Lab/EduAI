-- AlterTable
ALTER TABLE "user" ADD COLUMN "studentId" TEXT;

-- CreateTable
CREATE TABLE "canvas_roster_members" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "canvasUserId" TEXT NOT NULL,
    "sisUserId" TEXT,
    "email" TEXT,
    "displayName" TEXT,
    "role" "EnrollmentRole" NOT NULL,
    "syncedByUserId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvas_roster_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_studentId_key" ON "user"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "canvas_roster_members_courseId_canvasUserId_role_key" ON "canvas_roster_members"("courseId", "canvasUserId", "role");

-- CreateIndex
CREATE INDEX "canvas_roster_members_email_idx" ON "canvas_roster_members"("email");

-- CreateIndex
CREATE INDEX "canvas_roster_members_sisUserId_idx" ON "canvas_roster_members"("sisUserId");

-- CreateIndex
CREATE INDEX "canvas_roster_members_canvasUserId_idx" ON "canvas_roster_members"("canvasUserId");

-- AddForeignKey
ALTER TABLE "canvas_roster_members" ADD CONSTRAINT "canvas_roster_members_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canvas_roster_members" ADD CONSTRAINT "canvas_roster_members_syncedByUserId_fkey" FOREIGN KEY ("syncedByUserId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
