-- Supports the bounded recent-completion lookup used by the status ETA poller.
CREATE INDEX "ai_jobs_queueName_status_completedAt_idx"
ON "ai_jobs"("queueName", "status", "completedAt");
