import { appendFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const CORE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const DEFAULT_RE_EMBED_LOG_PATH = path.join(CORE_ROOT, "logs", "re-embed.jsonl");

export type ReEmbedLogEvent =
  | "material-ok"
  | "material-failed"
  | "job-finished"
  | "job-crashed";

export type ReEmbedLogEntry = {
  ts: string;
  event: ReEmbedLogEvent;
  courseId: string;
  materialId?: string;
  title?: string;
  error?: string;
  cause?: string;
  jobId?: string;
  processed?: number;
  failedCount?: number;
  total?: number;
  failedMaterialIds?: string[];
  status?: string;
};

function resolveReEmbedLogPath(): string {
  const override = process.env.RE_EMBED_LOG_PATH?.trim();
  return override || DEFAULT_RE_EMBED_LOG_PATH;
}

function extractCause(err: unknown): string | undefined {
  if (!(err instanceof Error) || err.cause == null) return undefined;
  if (err.cause instanceof Error) return err.cause.message;
  return String(err.cause);
}

export function formatEmbeddingError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return err.message;
}

async function appendReEmbedLogEntry(entry: ReEmbedLogEntry): Promise<void> {
  const logPath = resolveReEmbedLogPath();
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}

/** Append JSONL to apps/core/logs/re-embed.jsonl (or RE_EMBED_LOG_PATH). Mirrors one line to stderr. */
export async function writeReEmbedLog(entry: Omit<ReEmbedLogEntry, "ts">): Promise<void> {
  const full: ReEmbedLogEntry = { ts: new Date().toISOString(), ...entry };
  const line = JSON.stringify(full);

  try {
    await appendReEmbedLogEntry(full);
  } catch (writeErr) {
    console.error("[embedding-log] failed to write re-embed log file", {
      path: resolveReEmbedLogPath(),
      error: writeErr instanceof Error ? writeErr.message : String(writeErr),
    });
  }

  if (full.event === "material-failed") {
    console.error(`[embedding-log] ${line}`);
  } else {
    console.log(`[embedding-log] ${line}`);
  }
}

export async function logReEmbedMaterialOk(params: {
  courseId: string;
  materialId: string;
  title: string;
}): Promise<void> {
  await writeReEmbedLog({
    event: "material-ok",
    courseId: params.courseId,
    materialId: params.materialId,
    title: params.title,
  });
}

export async function logReEmbedMaterialFailed(params: {
  courseId: string;
  materialId: string;
  title: string;
  err: unknown;
}): Promise<void> {
  await writeReEmbedLog({
    event: "material-failed",
    courseId: params.courseId,
    materialId: params.materialId,
    title: params.title,
    error: formatEmbeddingError(params.err),
    cause: extractCause(params.err),
  });
}

export async function logReEmbedJobFinished(params: {
  courseId: string;
  jobId?: string;
  status: string;
  processed: number;
  failedCount: number;
  total: number;
  failedMaterialIds: string[];
}): Promise<void> {
  await writeReEmbedLog({
    event: "job-finished",
    courseId: params.courseId,
    jobId: params.jobId,
    status: params.status,
    processed: params.processed,
    failedCount: params.failedCount,
    total: params.total,
    failedMaterialIds: params.failedMaterialIds,
  });
}

export async function logReEmbedJobCrashed(params: {
  courseId: string;
  jobId: string;
  err: unknown;
}): Promise<void> {
  await writeReEmbedLog({
    event: "job-crashed",
    courseId: params.courseId,
    jobId: params.jobId,
    error: formatEmbeddingError(params.err),
    cause: extractCause(params.err),
  });
}

export function getReEmbedLogPath(): string {
  return resolveReEmbedLogPath();
}
