/**
 * Cascade-delete propagation (§802): after a course is soft-deleted in Core,
 * push a best-effort delete to QM and AI Tutor so linked data (question banks,
 * session history, etc.) doesn't outlive the course. Core has no other outbound
 * caller today — QM/AI Tutor otherwise only ever call *into* Core — so this is
 * a new direction, authenticated with the same EDUAI_API_KEY service key those
 * extensions already send us.
 *
 * Failures here are logged, never thrown: the course delete itself already
 * succeeded, and the extensions' own reconciliation cron (runReconciliation)
 * is the eventual-consistency backstop if a push is missed (extension down,
 * network partition, etc.).
 */
import { logSystemError } from "~/lib/logging.server";

const CASCADE_TIMEOUT_MS = 5000;

type ExtensionTarget = { name: string; baseUrl: string | undefined };

async function pushDeleteToExtension(target: ExtensionTarget, courseId: string): Promise<void> {
  // Unconfigured in this environment (e.g. local dev running Core alone) — skip silently.
  if (!target.baseUrl) return;

  const apiKey = process.env.EDUAI_API_KEY;
  if (!apiKey) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CASCADE_TIMEOUT_MS);

  try {
    const response = await fetch(`${target.baseUrl}/api/internal/courses/${courseId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    if (!response.ok) {
      await logSystemError({
        source: "API",
        code: "CASCADE_DELETE_EXTENSION_FAILED",
        message: `Cascade delete to ${target.name} responded with status ${response.status}`,
        details: { courseId, extension: target.name, status: response.status },
      });
    }
  } catch (error) {
    await logSystemError({
      source: "API",
      code: "CASCADE_DELETE_EXTENSION_FAILED",
      message: `Cascade delete to ${target.name} failed`,
      details: { courseId, extension: target.name },
      error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Fires cascade-delete calls to QM and AI Tutor in parallel; never throws. */
export async function cascadeDeleteToExtensions(courseId: string): Promise<void> {
  await Promise.allSettled([
    pushDeleteToExtension({ name: "question-maker", baseUrl: process.env.QM_BACKEND_URL }, courseId),
    pushDeleteToExtension({ name: "ai-tutor", baseUrl: process.env.AI_TUTOR_SERVER_URL }, courseId),
  ]);
}
