/*
  Warnings:

  - Added the required column `mainTopicId` to the `Activity` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."Activity" ADD COLUMN     "mainTopicId" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "public"."Topic" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "courseOfferingId" INTEGER NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ActivitySecondaryTopic" (
    "activityId" INTEGER NOT NULL,
    "topicId" INTEGER NOT NULL,

    CONSTRAINT "ActivitySecondaryTopic_pkey" PRIMARY KEY ("activityId","topicId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Topic_courseOfferingId_name_key" ON "public"."Topic"("courseOfferingId", "name");

-- AddForeignKey
ALTER TABLE "public"."Topic" ADD CONSTRAINT "Topic_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "public"."CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Activity" ADD CONSTRAINT "Activity_mainTopicId_fkey" FOREIGN KEY ("mainTopicId") REFERENCES "public"."Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ActivitySecondaryTopic" ADD CONSTRAINT "ActivitySecondaryTopic_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "public"."Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ActivitySecondaryTopic" ADD CONSTRAINT "ActivitySecondaryTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "public"."Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
