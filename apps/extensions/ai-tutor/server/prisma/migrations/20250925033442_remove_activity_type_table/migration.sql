/*
  Warnings:

  - You are about to drop the column `activityTypeId` on the `Activity` table. All the data in the column will be lost.
  - You are about to drop the column `activityTypeId` on the `PromptTemplate` table. All the data in the column will be lost.
  - You are about to drop the `ActivityType` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."Activity" DROP CONSTRAINT "Activity_activityTypeId_fkey";

-- DropForeignKey
ALTER TABLE "public"."PromptTemplate" DROP CONSTRAINT "PromptTemplate_activityTypeId_fkey";

-- AlterTable
ALTER TABLE "public"."Activity" DROP COLUMN "activityTypeId";

-- AlterTable
ALTER TABLE "public"."PromptTemplate" DROP COLUMN "activityTypeId";

-- DropTable
DROP TABLE "public"."ActivityType";
