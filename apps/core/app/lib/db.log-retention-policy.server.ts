/**
 * Log-retention policy storage and cleanup helpers.
 *
 * This module keeps retention configuration in one DB-backed singleton so
 * admin UI updates, on-demand cleanup actions, and periodic sweeps all read
 * from the same policy source.
 */
import prisma from "~/lib/prisma.server";

const POLICY_ID = "default";
const DEFAULT_AUDIT_RETENTION_DAYS = 365;
const DEFAULT_SYSTEM_RETENTION_DAYS = 90;
const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3650;

const DEFAULT_AUTO_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

let isAutoSweepRunning = false;
let lastAutoSweepStartedAt = 0;

export type LogRetentionPolicyInput = {
  auditRetentionDays: number;
  systemRetentionDays: number;
};

export type LogRetentionPolicyCleanupResult = {
  auditRetentionDays: number;
  systemRetentionDays: number;
  deletedAuditRows: number;
  deletedSystemRows: number;
};

/**
 * Normalizes user-provided day values so cleanup windows always stay within safe bounds.
 */
function normalizeRetentionDays(value: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.floor(value)));
}

/**
 * Converts retention day windows into timestamp cutoffs used by deleteMany queries.
 */
function buildCutoff(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Returns the singleton retention policy row, creating defaults on first access.
 */
export async function getLogRetentionPolicy() {
  const existing = await prisma.logRetentionPolicy.findUnique({
    where: { id: POLICY_ID },
  });

  if (existing) {
    return existing;
  }

  try {
    return await prisma.logRetentionPolicy.create({
      data: {
        id: POLICY_ID,
        auditRetentionDays: DEFAULT_AUDIT_RETENTION_DAYS,
        systemRetentionDays: DEFAULT_SYSTEM_RETENTION_DAYS,
      },
    });
  } catch (error) {
    const maybePrismaError = error as { code?: string };
    if (maybePrismaError?.code === "P2002") {
      // Concurrent first-access requests can race to create the singleton row.
      const racedRow = await prisma.logRetentionPolicy.findUnique({
        where: { id: POLICY_ID },
      });
      if (racedRow) {
        return racedRow;
      }
    }

    throw error;
  }
}

/**
 * Persists admin-selected retention values after enforcing integer bounds.
 */
export async function updateLogRetentionPolicy(input: LogRetentionPolicyInput) {
  // Ensure the singleton row exists so update remains deterministic on fresh databases.
  await getLogRetentionPolicy();

  const auditRetentionDays = normalizeRetentionDays(
    input.auditRetentionDays,
    DEFAULT_AUDIT_RETENTION_DAYS
  );
  const systemRetentionDays = normalizeRetentionDays(
    input.systemRetentionDays,
    DEFAULT_SYSTEM_RETENTION_DAYS
  );

  return prisma.logRetentionPolicy.update({
    where: { id: POLICY_ID },
    data: {
      auditRetentionDays,
      systemRetentionDays,
    },
  });
}

/**
 * Runs both audit and system retention cleanups using either provided or persisted windows.
 */
export async function runConfiguredLogRetention(
  input?: Partial<LogRetentionPolicyInput>
): Promise<LogRetentionPolicyCleanupResult> {
  const persistedPolicy = await getLogRetentionPolicy();

  const auditRetentionDays = normalizeRetentionDays(
    input?.auditRetentionDays ?? persistedPolicy.auditRetentionDays,
    persistedPolicy.auditRetentionDays
  );
  const systemRetentionDays = normalizeRetentionDays(
    input?.systemRetentionDays ?? persistedPolicy.systemRetentionDays,
    persistedPolicy.systemRetentionDays
  );

  // Running both delete queries in parallel keeps cleanup latency predictable for manual triggers.
  const [auditDeleteResult, systemDeleteResult] = await Promise.all([
    prisma.auditLog.deleteMany({
      where: { createdAt: { lt: buildCutoff(auditRetentionDays) } },
    }),
    prisma.systemLog.deleteMany({
      where: { createdAt: { lt: buildCutoff(systemRetentionDays) } },
    }),
  ]);

  return {
    auditRetentionDays,
    systemRetentionDays,
    deletedAuditRows: auditDeleteResult.count,
    deletedSystemRows: systemDeleteResult.count,
  };
}

/**
 * Executes periodic cleanup at most once per interval and swallows failures to keep app requests resilient.
 */
export async function runConfiguredLogRetentionIfDue(
  intervalMs = DEFAULT_AUTO_SWEEP_INTERVAL_MS
): Promise<void> {
  const safeIntervalMs = Number.isFinite(intervalMs)
    ? Math.max(60_000, Math.floor(intervalMs))
    : DEFAULT_AUTO_SWEEP_INTERVAL_MS;

  const now = Date.now();
  if (isAutoSweepRunning) {
    return;
  }

  if (now - lastAutoSweepStartedAt < safeIntervalMs) {
    return;
  }

  // Reserve the slot before awaiting so concurrent requests don't double-run,
  // but remember the previous timestamp so a failed sweep can be retried on the
  // next request instead of being suppressed for a full interval.
  const previousSweepStartedAt = lastAutoSweepStartedAt;
  isAutoSweepRunning = true;
  lastAutoSweepStartedAt = now;

  try {
    await runConfiguredLogRetention();
  } catch (error) {
    // Cleanup failures should be observable but must never block auth or domain mutations.
    // Roll back the throttle timestamp so the next request can retry the sweep.
    lastAutoSweepStartedAt = previousSweepStartedAt;
    console.error("[LOG_RETENTION_SWEEP_FAILED]", error);
  } finally {
    isAutoSweepRunning = false;
  }
}
