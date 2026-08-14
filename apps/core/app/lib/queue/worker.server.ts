import { Prisma } from "@prisma/client";
import {
  Worker,
  type ConnectionOptions,
  type Job,
  type WorkerOptions,
} from "bullmq";
import { runCompletion } from "~/lib/ai/completion.server";
import { persistAiInteractionTelemetry } from "~/lib/ai/routing/telemetry.server";
import { isAutoRoutingModelId } from "~/lib/chat-auto-model";
import { fireAndForget, logSystemError } from "~/lib/logging.server";
import prisma from "~/lib/prisma.server";
import redis from "./connection.server";
import {
  JobPayloadSchema,
  type JobPayload,
  type QueuedJobPayload,
} from "./job-schema";
import { AI_JOB_QUEUE_NAMES } from "./queues.server";
import { type QueueName } from "./resolve-pool.server";
import { workerConcurrency } from "./concurrency.server";

export { workerConcurrency } from "./concurrency.server";

const DEFAULT_WORKER_MODEL = "vllm:qwen2.5-32b-instruct";
const DEFAULT_AI_JOB_TIMEOUT_MS = 120_000;

export type AiJobResult = {
  kind: JobPayload["kind"];
  model: string;
  output: {
    content: string;
    requestedCount: number;
  };
  usage?: unknown;
  fleetHost?: string | null;
  fleetServerId?: string | null;
};

export type AiJobWorkerOutcome =
  | AiJobResult
  | { skipped: true; reason: "cancelled" | "already-terminal" };

export type ExecuteAiJob = (payload: JobPayload) => Promise<AiJobResult>;

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function aiJobTimeoutMs(): number {
  return positiveInt(
    process.env.AI_JOB_EXECUTION_TIMEOUT_MS,
    DEFAULT_AI_JOB_TIMEOUT_MS,
  );
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown AI job failure";
  }
}

function serverApiKeys(model: string): Record<string, {
  isEnabled: boolean;
  apiKey?: string;
}> {
  if (model.startsWith("openai:") && process.env.OPENAI_API_KEY) {
    return {
      openai: {
        isEnabled: true,
        apiKey: process.env.OPENAI_API_KEY,
      },
    };
  }
  if (model.startsWith("google:") && process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return {
      google: {
        isEnabled: true,
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      },
    };
  }
  return {};
}

async function resolveWorkerModel(payload: JobPayload): Promise<string> {
  const requested = payload.requestedModel?.trim();
  if (requested && !isAutoRoutingModelId(requested)) {
    return requested;
  }

  const configured = process.env.AI_JOB_DEFAULT_MODEL?.trim();
  if (configured) {
    return configured;
  }

  try {
    const { resolveRoutedModel } = await import("~/lib/ai/routing/router");
    const decision = await resolveRoutedModel(
      payload.input.prompt,
      {
        courseId: payload.courseId ?? null,
        imagesPresent: false,
        courseRagNeeded: Boolean(payload.courseId),
      },
      requested === "auto-llm" ? { modeOverride: "llm" } : undefined,
    );
    return decision.modelId;
  } catch (error) {
    console.error(
      "[ai-job-worker] Auto model routing failed; using worker fallback",
      error,
    );
    return DEFAULT_WORKER_MODEL;
  }
}

/**
 * Execute the v1 async work kind using the same fleet-aware completion seam as
 * extension completions. The worker owns server-side provider credentials; no
 * browser/localStorage secrets are serialized into the queue payload.
 */
export async function executeAiJobPayload(payload: JobPayload): Promise<AiJobResult> {
  switch (payload.kind) {
    case "question-generation": {
      const requestStartMs = Date.now();
      const model = await resolveWorkerModel(payload);
      const prompt = payload.input.prompt;
      const completion = await runCompletion({
        model,
        apiKeys: serverApiKeys(model),
        systemPrompt:
          `Generate exactly ${payload.input.count} high-quality course questions. ` +
          "Return only the generated questions in a clear, machine-readable format.",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        streaming: false,
        routingContext: { jobType: payload.type },
        signal: AbortSignal.timeout(aiJobTimeoutMs()),
      });

      if (!completion.ok) {
        throw new Error(completion.error);
      }
      if (completion.streaming) {
        throw new Error("AI job completion unexpectedly returned a stream");
      }

      // Mirrors chat.ts's persistTurnTelemetry: background AiJob completions
      // (question-generation via runCompletion) previously never wrote an
      // AIInteraction row, so the admin Servers tab's per-server/per-model
      // stats (which only ever queried AIInteraction) silently excluded all
      // async Question Maker traffic — a completed CMPS03 job, for example,
      // wouldn't move CMPS03's totals at all. Wrapped in its own try/catch
      // (on top of persistAiInteractionTelemetry's own internal one) so a
      // telemetry failure can never fail the job or its result — the job's
      // primary output already succeeded by this point.
      try {
        await persistAiInteractionTelemetry({
          userId: payload.userId,
          courseId: payload.courseId ?? null,
          resolvedModelId: completion.body.model,
          query: prompt,
          responseText: completion.body.content,
          usage: completion.body.usage,
          finishReason: completion.body.finishReason,
          durationMs: Date.now() - requestStartMs,
          wasAuto: isAutoRoutingModelId(payload.requestedModel ?? ""),
          routingTier: null,
          routerVersion: null,
          routerFeatures: null,
          serverId: completion.internal.fleetServerId,
        });
      } catch (err) {
        console.error("[ai-job-worker] telemetry write failed", err);
      }

      return {
        kind: payload.kind,
        model: completion.body.model,
        output: {
          content: completion.body.content,
          requestedCount: payload.input.count,
        },
        usage: completion.body.usage,
        fleetHost: completion.internal.fleetHost,
        fleetServerId: completion.internal.fleetServerId,
      };
    }
  }
}

function maxAttempts(job: Job<JobPayload | QueuedJobPayload>): number {
  const attempts = job.opts.attempts;
  return typeof attempts === "number" && Number.isFinite(attempts)
    ? Math.max(1, Math.floor(attempts))
    : 1;
}

/**
 * Consume one BullMQ job and mirror its lifecycle into the authoritative
 * Postgres AiJob row. All lookups use (queueName, bullJobId), since BullMQ ids
 * are only unique within a queue.
 */
export async function processAiJob(
  job: Job<JobPayload | QueuedJobPayload>,
  queueName: QueueName,
  execute: ExecuteAiJob = executeAiJobPayload,
): Promise<AiJobWorkerOutcome> {
  if (job.id === undefined || job.id === null || String(job.id).length === 0) {
    throw new Error(`BullMQ job in ${queueName} has no id`);
  }
  const bullJobId = String(job.id);

  const aiJobId =
    "aiJobId" in job.data && typeof job.data.aiJobId === "string"
      ? job.data.aiJobId
      : null;
  const select = {
    id: true,
    status: true,
    startedAt: true,
    userId: true,
    queueName: true,
    bullJobId: true,
  } as const;
  const row =
    (aiJobId
      ? await prisma.aiJob.findUnique({
          where: { id: aiJobId },
          select,
        })
      : null) ??
    (await prisma.aiJob.findUnique({
      where: {
        queueName_bullJobId: {
          queueName,
          bullJobId,
        },
      },
      select,
    }));

  if (!row) {
    throw new Error(
      aiJobId
        ? `No AiJob row ${aiJobId} for ${queueName}/${bullJobId}`
        : `No AiJob row for ${queueName}/${bullJobId}`,
    );
  }
  if (
    row.queueName !== queueName ||
    (row.bullJobId !== null && row.bullJobId !== bullJobId)
  ) {
    throw new Error(
      `AiJob ${row.id} does not belong to ${queueName}/${bullJobId}`,
    );
  }
  if (row.status === "CANCELLED") {
    return { skipped: true, reason: "cancelled" };
  }
  if (row.status === "COMPLETED" || row.status === "FAILED") {
    return { skipped: true, reason: "already-terminal" };
  }

  const claimed = await prisma.aiJob.updateMany({
    where: {
      id: row.id,
      status: "PENDING",
    },
    data: {
      status: "RUNNING",
      startedAt: row.startedAt ?? new Date(),
      completedAt: null,
      errorMessage: null,
      attempts: { increment: 1 },
    },
  });

  if (claimed.count !== 1) {
    const latest = await prisma.aiJob.findUnique({
      where: { id: row.id },
      select: { status: true },
    });
    if (latest?.status === "CANCELLED") {
      return { skipped: true, reason: "cancelled" };
    }
    throw new Error(`Could not claim AiJob ${row.id}`);
  }

  try {
    const payload = JobPayloadSchema.parse(job.data);
    if (job.name !== payload.kind) {
      throw new Error(
        `BullMQ job name "${job.name}" does not match payload kind "${payload.kind}"`,
      );
    }

    const result = await execute(payload);
    await prisma.aiJob.updateMany({
      where: { id: row.id, status: "RUNNING" },
      data: {
        status: "COMPLETED",
        result: result as unknown as Prisma.InputJsonValue,
        errorMessage: null,
        completedAt: new Date(),
      },
    });
    return result;
  } catch (error) {
    const finalAttempt = job.attemptsMade + 1 >= maxAttempts(job);
    const message = formatError(error);

    await prisma.aiJob.updateMany({
      where: { id: row.id, status: "RUNNING" },
      data: finalAttempt
        ? {
            status: "FAILED",
            errorMessage: message,
            completedAt: new Date(),
          }
        : {
            status: "PENDING",
            errorMessage: message,
            completedAt: null,
          },
    });

    fireAndForget(
      logSystemError({
        source: "AI",
        code: finalAttempt ? "ai_job_failed" : "ai_job_retry",
        message: `AI job ${row.id} failed attempt ${job.attemptsMade + 1}/${maxAttempts(job)}`,
        error,
        actorUserId: row.userId,
        details: {
          jobId: row.id,
          bullJobId,
          queueName,
          kind: job.name,
          finalAttempt,
        },
      }),
    );
    throw error;
  }
}

export function createAiJobWorker(
  queueName: QueueName,
  options: Partial<WorkerOptions> = {},
  execute: ExecuteAiJob = executeAiJobPayload,
): Worker<JobPayload | QueuedJobPayload, AiJobWorkerOutcome> {
  const worker = new Worker<JobPayload | QueuedJobPayload, AiJobWorkerOutcome>(
    queueName,
    (job) => processAiJob(job, queueName, execute),
    {
      connection: redis as unknown as ConnectionOptions,
      concurrency: workerConcurrency(queueName),
      ...options,
    },
  );

  worker.on("error", (error) => {
    console.error(`[ai-job-worker:${queueName}] worker error`, error);
  });
  worker.on("failed", (job, error) => {
    console.error(
      `[ai-job-worker:${queueName}] job ${job?.id ?? "unknown"} failed`,
      error,
    );
  });
  return worker;
}

export function startAiJobWorkers(): Worker<
  JobPayload | QueuedJobPayload,
  AiJobWorkerOutcome
>[] {
  return AI_JOB_QUEUE_NAMES.map((queueName) => createAiJobWorker(queueName));
}

export async function closeAiJobWorkers(
  workers: Worker<JobPayload | QueuedJobPayload, AiJobWorkerOutcome>[],
): Promise<void> {
  await Promise.all(workers.map((worker) => worker.close()));
}
