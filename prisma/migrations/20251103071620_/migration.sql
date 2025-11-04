/*
  Warnings:

  - You are about to drop the `topics` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "topics" DROP CONSTRAINT "topics_courseId_fkey";

-- DropTable
DROP TABLE "topics";
