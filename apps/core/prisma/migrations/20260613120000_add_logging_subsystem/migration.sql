-- CreateEnum
CREATE TYPE "AuditLogCategory" AS ENUM ('USER', 'INVITATION', 'COURSE', 'ENROLLMENT', 'MATERIAL', 'TOPIC', 'AI_CONFIG', 'CANVAS', 'BUG_REPORT', 'SECURITY');

-- CreateEnum
CREATE TYPE "AuditLogOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateEnum
CREATE TYPE "SystemLogLevel" AS ENUM ('ERROR', 'WARN', 'INFO');

-- CreateEnum
CREATE TYPE "SystemLogSource" AS ENUM ('ROUTE', 'AUTH', 'AI', 'CANVAS', 'MAIL', 'DB', 'SSR', 'API');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "category" "AuditLogCategory" NOT NULL,
    "outcome" "AuditLogOutcome" NOT NULL DEFAULT 'SUCCESS',
    "actionCode" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'USER',
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "entityLabel" TEXT,
    "details" JSONB,
    "requestId" TEXT,
    "routePath" TEXT,
    "httpMethod" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" "SystemLogLevel" NOT NULL,
    "source" "SystemLogSource" NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "errorName" TEXT,
    "stack" TEXT,
    "details" JSONB,
    "actorUserId" TEXT,
    "actorRole" TEXT,
    "requestId" TEXT,
    "routePath" TEXT,
    "httpMethod" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "statusCode" INTEGER,

    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_retention_policy" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "auditRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "systemRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "log_retention_policy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_category_createdAt_idx" ON "audit_logs"("category", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actionCode_createdAt_idx" ON "audit_logs"("actionCode", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_createdAt_idx" ON "audit_logs"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_routePath_createdAt_idx" ON "audit_logs"("routePath", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_outcome_createdAt_idx" ON "audit_logs"("outcome", "createdAt");

-- CreateIndex
CREATE INDEX "system_logs_createdAt_idx" ON "system_logs"("createdAt");

-- CreateIndex
CREATE INDEX "system_logs_level_createdAt_idx" ON "system_logs"("level", "createdAt");

-- CreateIndex
CREATE INDEX "system_logs_source_createdAt_idx" ON "system_logs"("source", "createdAt");

-- CreateIndex
CREATE INDEX "system_logs_code_createdAt_idx" ON "system_logs"("code", "createdAt");

-- CreateIndex
CREATE INDEX "system_logs_actorUserId_createdAt_idx" ON "system_logs"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_logs" ADD CONSTRAINT "system_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
