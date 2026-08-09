CREATE TABLE "pull_request_notifications" (
    "id" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "threadId" TEXT,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "latestCommitSha" TEXT,
    "reviewers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "approvers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "linkedIssues" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "reviewRequestedAt" TIMESTAMP(3),
    "changesRequestedAt" TIMESTAMP(3),
    "lastAuthorCommitAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReviewerReminderAt" TIMESTAMP(3),
    "reviewerEscalatedAt" TIMESTAMP(3),
    "lastAuthorReminderAt" TIMESTAMP(3),
    "lastChangesReminderAt" TIMESTAMP(3),
    "lastCiFailureSha" TEXT,
    "ciIsGreen" BOOLEAN NOT NULL DEFAULT false,
    "hasMergeConflict" BOOLEAN NOT NULL DEFAULT false,
    "readyNotificationSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pull_request_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pull_request_notifications_repository_number_key"
  ON "pull_request_notifications"("repository", "number");
CREATE INDEX "pull_request_notifications_isOpen_lastActivityAt_idx"
  ON "pull_request_notifications"("isOpen", "lastActivityAt");
