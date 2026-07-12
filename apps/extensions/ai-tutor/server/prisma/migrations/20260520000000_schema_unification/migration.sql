-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."PromptTemplate" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION,
    "topP" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."CourseOffering" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "externalId" TEXT,
    "externalSource" TEXT,
    "externalMetadata" JSONB,
    "coreOfferingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseOffering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."Topic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "coreTopicId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "courseOfferingId" INTEGER NOT NULL,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."Module" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "courseOfferingId" INTEGER NOT NULL,

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."Lesson" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "contentMd" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "moduleId" INTEGER NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."Activity" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "instructionsMd" TEXT NOT NULL,
    "config" JSONB,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lessonId" INTEGER NOT NULL,
    "promptTemplateId" INTEGER,
    "customPrompt" TEXT,
    "customPromptTitle" TEXT,
    "mainTopicId" TEXT NOT NULL,
    "enableTeachMode" BOOLEAN NOT NULL DEFAULT true,
    "enableGuideMode" BOOLEAN NOT NULL DEFAULT true,
    "enableCustomMode" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."Submission" (
    "id" SERIAL NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "response" JSONB,
    "aiFeedback" JSONB,
    "score" DOUBLE PRECISION,
    "isCorrect" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "activityId" INTEGER NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."ActivitySecondaryTopic" (
    "activityId" INTEGER NOT NULL,
    "topicId" TEXT NOT NULL,

    CONSTRAINT "ActivitySecondaryTopic_pkey" PRIMARY KEY ("activityId","topicId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."SystemPrompt" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."ActivityFeedback" (
    "id" SERIAL NOT NULL,
    "rating" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "activityId" INTEGER NOT NULL,
    "submissionId" INTEGER,

    CONSTRAINT "ActivityFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."ActivityStudentMetric" (
    "id" SERIAL NOT NULL,
    "helpRequestCount" INTEGER NOT NULL DEFAULT 0,
    "submissionCount" INTEGER NOT NULL DEFAULT 0,
    "incorrectSubmissionCount" INTEGER NOT NULL DEFAULT 0,
    "correctSubmissionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "activityId" INTEGER NOT NULL,

    CONSTRAINT "ActivityStudentMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."ActivityAnalytics" (
    "id" SERIAL NOT NULL,
    "helpRequestCount" INTEGER NOT NULL DEFAULT 0,
    "submissionCount" INTEGER NOT NULL DEFAULT 0,
    "incorrectSubmissionCount" INTEGER NOT NULL DEFAULT 0,
    "correctSubmissionCount" INTEGER NOT NULL DEFAULT 0,
    "studentCount" INTEGER NOT NULL DEFAULT 0,
    "feedbackCount" INTEGER NOT NULL DEFAULT 0,
    "averageRating" DOUBLE PRECISION,
    "difficultyScore" INTEGER NOT NULL DEFAULT 0,
    "difficultyLabel" TEXT NOT NULL DEFAULT 'LOW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activityId" INTEGER NOT NULL,

    CONSTRAINT "ActivityAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."SuggestedPrompt" (
    "id" SERIAL NOT NULL,
    "mode" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuggestedPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."AiChatSession" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "activityId" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "modelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "public"."AiInteractionTrace" (
    "id" SERIAL NOT NULL,
    "mode" TEXT NOT NULL,
    "knowledgeLevel" TEXT,
    "chatId" TEXT,
    "tutorModelId" TEXT,
    "supervisorModelId" TEXT,
    "userMessage" TEXT NOT NULL,
    "finalResponse" TEXT NOT NULL,
    "finalOutcome" TEXT NOT NULL,
    "iterationCount" INTEGER NOT NULL DEFAULT 0,
    "trace" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "activityId" INTEGER NOT NULL,
    "aiChatSessionId" INTEGER,

    CONSTRAINT "AiInteractionTrace_pkey" PRIMARY KEY ("id")
);

-- EnsureColumns: add any columns missing from pre-existing tables
ALTER TABLE IF EXISTS "public"."CourseOffering" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE IF EXISTS "public"."CourseOffering" ADD COLUMN IF NOT EXISTS "startDate" TIMESTAMP(3);
ALTER TABLE IF EXISTS "public"."CourseOffering" ADD COLUMN IF NOT EXISTS "endDate" TIMESTAMP(3);
ALTER TABLE IF EXISTS "public"."CourseOffering" ADD COLUMN IF NOT EXISTS "isPublished" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE IF EXISTS "public"."CourseOffering" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE IF EXISTS "public"."CourseOffering" ADD COLUMN IF NOT EXISTS "externalSource" TEXT;
ALTER TABLE IF EXISTS "public"."CourseOffering" ADD COLUMN IF NOT EXISTS "externalMetadata" JSONB;
ALTER TABLE IF EXISTS "public"."CourseOffering" ADD COLUMN IF NOT EXISTS "coreOfferingId" TEXT;

ALTER TABLE IF EXISTS "public"."Topic" ADD COLUMN IF NOT EXISTS "coreTopicId" TEXT;
ALTER TABLE IF EXISTS "public"."Topic" ADD COLUMN IF NOT EXISTS "courseOfferingId" INTEGER;

ALTER TABLE IF EXISTS "public"."Activity" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE IF EXISTS "public"."Activity" ADD COLUMN IF NOT EXISTS "config" JSONB;
ALTER TABLE IF EXISTS "public"."Activity" ADD COLUMN IF NOT EXISTS "promptTemplateId" INTEGER;
ALTER TABLE IF EXISTS "public"."Activity" ADD COLUMN IF NOT EXISTS "customPrompt" TEXT;
ALTER TABLE IF EXISTS "public"."Activity" ADD COLUMN IF NOT EXISTS "customPromptTitle" TEXT;
ALTER TABLE IF EXISTS "public"."Activity" ADD COLUMN IF NOT EXISTS "mainTopicId" TEXT NOT NULL DEFAULT '';
ALTER TABLE IF EXISTS "public"."Activity" ADD COLUMN IF NOT EXISTS "enableTeachMode" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE IF EXISTS "public"."Activity" ADD COLUMN IF NOT EXISTS "enableGuideMode" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE IF EXISTS "public"."Activity" ADD COLUMN IF NOT EXISTS "enableCustomMode" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS "public"."AiChatSession" ADD COLUMN IF NOT EXISTS "modelId" TEXT;

ALTER TABLE IF EXISTS "public"."AiInteractionTrace" ADD COLUMN IF NOT EXISTS "knowledgeLevel" TEXT;
ALTER TABLE IF EXISTS "public"."AiInteractionTrace" ADD COLUMN IF NOT EXISTS "chatId" TEXT;
ALTER TABLE IF EXISTS "public"."AiInteractionTrace" ADD COLUMN IF NOT EXISTS "tutorModelId" TEXT;
ALTER TABLE IF EXISTS "public"."AiInteractionTrace" ADD COLUMN IF NOT EXISTS "supervisorModelId" TEXT;
ALTER TABLE IF EXISTS "public"."AiInteractionTrace" ADD COLUMN IF NOT EXISTS "aiChatSessionId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PromptTemplate_slug_key" ON "public"."PromptTemplate"("slug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CourseOffering_coreOfferingId_key" ON "public"."CourseOffering"("coreOfferingId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CourseOffering_externalId_idx" ON "public"."CourseOffering"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Topic_coreTopicId_key" ON "public"."Topic"("coreTopicId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Topic_courseOfferingId_name_key" ON "public"."Topic"("courseOfferingId", "name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SystemPrompt_slug_key" ON "public"."SystemPrompt"("slug");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ActivityFeedback_userId_activityId_key" ON "public"."ActivityFeedback"("userId", "activityId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ActivityStudentMetric_userId_activityId_key" ON "public"."ActivityStudentMetric"("userId", "activityId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ActivityAnalytics_activityId_key" ON "public"."ActivityAnalytics"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AiChatSession_userId_activityId_mode_key" ON "public"."AiChatSession"("userId", "activityId", "mode");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "public"."Topic" ADD CONSTRAINT "Topic_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "public"."CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "public"."Module" ADD CONSTRAINT "Module_courseOfferingId_fkey" FOREIGN KEY ("courseOfferingId") REFERENCES "public"."CourseOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "public"."Lesson" ADD CONSTRAINT "Lesson_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "public"."Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "public"."Activity" ADD CONSTRAINT "Activity_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "public"."Lesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "public"."Activity" ADD CONSTRAINT "Activity_promptTemplateId_fkey" FOREIGN KEY ("promptTemplateId") REFERENCES "public"."PromptTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "public"."Activity" ADD CONSTRAINT "Activity_mainTopicId_fkey" FOREIGN KEY ("mainTopicId") REFERENCES "public"."Topic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "public"."Submission" ADD CONSTRAINT "Submission_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "public"."Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "public"."ActivitySecondaryTopic" ADD CONSTRAINT "ActivitySecondaryTopic_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "public"."Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "public"."ActivitySecondaryTopic" ADD CONSTRAINT "ActivitySecondaryTopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "public"."Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "public"."ActivityFeedback" ADD CONSTRAINT "ActivityFeedback_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "public"."Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "public"."ActivityFeedback" ADD CONSTRAINT "ActivityFeedback_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "public"."Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "public"."ActivityStudentMetric" ADD CONSTRAINT "ActivityStudentMetric_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "public"."Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "public"."ActivityAnalytics" ADD CONSTRAINT "ActivityAnalytics_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "public"."Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "public"."AiChatSession" ADD CONSTRAINT "AiChatSession_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "public"."Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "public"."AiInteractionTrace" ADD CONSTRAINT "AiInteractionTrace_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "public"."Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "public"."AiInteractionTrace" ADD CONSTRAINT "AiInteractionTrace_aiChatSessionId_fkey" FOREIGN KEY ("aiChatSessionId") REFERENCES "public"."AiChatSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
