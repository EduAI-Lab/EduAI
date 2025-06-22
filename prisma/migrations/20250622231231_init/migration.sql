/*
  Warnings:

  - Added the required column `aiInstructions` to the `courses` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "aiInstructions" TEXT NOT NULL;
