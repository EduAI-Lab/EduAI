CREATE TABLE "public"."ActivityFeedback" (
    "id" SERIAL NOT NULL,
    "rating" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER NOT NULL,
    "activityId" INTEGER NOT NULL,
    "submissionId" INTEGER,

    CONSTRAINT "ActivityFeedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."ActivityStudentMetric" (
    "id" SERIAL NOT NULL,
    "helpRequestCount" INTEGER NOT NULL DEFAULT 0,
    "submissionCount" INTEGER NOT NULL DEFAULT 0,
    "incorrectSubmissionCount" INTEGER NOT NULL DEFAULT 0,
    "correctSubmissionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER NOT NULL,
    "activityId" INTEGER NOT NULL,

    CONSTRAINT "ActivityStudentMetric_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."ActivityAnalytics" (
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

CREATE TABLE "public"."AiInteractionTrace" (
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
    "userId" INTEGER NOT NULL,
    "activityId" INTEGER NOT NULL,
    "aiChatSessionId" INTEGER,

    CONSTRAINT "AiInteractionTrace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActivityFeedback_userId_activityId_key" ON "public"."ActivityFeedback"("userId", "activityId");
CREATE UNIQUE INDEX "ActivityStudentMetric_userId_activityId_key" ON "public"."ActivityStudentMetric"("userId", "activityId");
CREATE UNIQUE INDEX "ActivityAnalytics_activityId_key" ON "public"."ActivityAnalytics"("activityId");

ALTER TABLE "public"."ActivityFeedback"
ADD CONSTRAINT "ActivityFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ActivityFeedback"
ADD CONSTRAINT "ActivityFeedback_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "public"."Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ActivityFeedback"
ADD CONSTRAINT "ActivityFeedback_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "public"."Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."ActivityStudentMetric"
ADD CONSTRAINT "ActivityStudentMetric_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ActivityStudentMetric"
ADD CONSTRAINT "ActivityStudentMetric_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "public"."Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."ActivityAnalytics"
ADD CONSTRAINT "ActivityAnalytics_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "public"."Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."AiInteractionTrace"
ADD CONSTRAINT "AiInteractionTrace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."AiInteractionTrace"
ADD CONSTRAINT "AiInteractionTrace_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "public"."Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."AiInteractionTrace"
ADD CONSTRAINT "AiInteractionTrace_aiChatSessionId_fkey" FOREIGN KEY ("aiChatSessionId") REFERENCES "public"."AiChatSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
