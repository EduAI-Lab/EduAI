-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'UNIT_ADMIN';

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "department" TEXT;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "authorizedUnits" TEXT[];
