-- CreateEnum
CREATE TYPE "ChatbotType" AS ENUM ('LEARNING', 'ADMIN');

-- AlterTable
ALTER TABLE "chats" ADD COLUMN "chatbot_type" "ChatbotType" NOT NULL DEFAULT 'LEARNING';
