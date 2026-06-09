#!/usr/bin/env tsx
/**
 * Aggregate AssistiveEvent rows for OFF vs ON before/after reporting.
 * Usage (from apps/core):
 *   npx tsx scripts/report-adhd-metrics.ts
 *   npx tsx scripts/report-adhd-metrics.ts --since 2026-06-09
 */

import { PrismaClient } from "@prisma/client";
import { parseArgs } from "node:util";

const prisma = new PrismaClient();

type ComplianceRow = {
  adhdAssist: boolean;
  wordCount: number;
  structuralPass: boolean;
  durationMs: number | null;
};

function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
}

/** Independent-samples Cohen's d (OFF vs ON). */
function cohensDIndependent(off: number[], on: number[]): number {
  if (off.length < 2 || on.length < 2) return NaN;
  const mOff = mean(off);
  const mOn = mean(on);
  const pooled = Math.sqrt(
    ((off.length - 1) * variance(off) + (on.length - 1) * variance(on)) /
      (off.length + on.length - 2),
  );
  if (pooled === 0) return 0;
  return (mOff - mOn) / pooled;
}

function parseCompliance(
  metricsJson: unknown,
  adhdAssist: boolean,
): ComplianceRow | null {
  if (!metricsJson || typeof metricsJson !== "object" || Array.isArray(metricsJson)) {
    return null;
  }
  const m = metricsJson as Record<string, unknown>;
  if (typeof m.wordCount !== "number") return null;
  return {
    adhdAssist,
    wordCount: m.wordCount,
    structuralPass: Boolean(m.structuralPass),
    durationMs: typeof m.durationMs === "number" ? m.durationMs : null,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      since: { type: "string" },
      event: { type: "string", default: "response_compliance" },
    },
  });

  const since = values.since ? new Date(values.since) : undefined;
  const eventType = values.event ?? "response_compliance";

  const events = await prisma.assistiveEvent.findMany({
    where: {
      eventType,
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    select: {
      adhdAssist: true,
      metricsJson: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const offRows: ComplianceRow[] = [];
  const onRows: ComplianceRow[] = [];

  for (const event of events) {
    const row = parseCompliance(event.metricsJson, event.adhdAssist);
    if (!row) continue;
    if (event.adhdAssist) onRows.push(row);
    else offRows.push(row);
  }

  const offWords = offRows.map((r) => r.wordCount);
  const onWords = onRows.map((r) => r.wordCount);
  const offPass = offRows.filter((r) => r.structuralPass).length;
  const onPass = onRows.filter((r) => r.structuralPass).length;
  const offDurations = offRows.map((r) => r.durationMs).filter((v): v is number => v != null);
  const onDurations = onRows.map((r) => r.durationMs).filter((v): v is number => v != null);

  const lines = [
    `# ADHD Assist telemetry — ${eventType}`,
    "",
    `Events: ${events.length} (OFF n=${offRows.length}, ON n=${onRows.length})`,
    since ? `Since: ${since.toISOString()}` : "Since: (all time)",
    "",
    "| Metric | OFF | ON | Cohen's d (OFF−ON) |",
    "| --- | ---: | ---: | ---: |",
    `| Mean word count | ${mean(offWords).toFixed(1)} | ${mean(onWords).toFixed(1)} | ${cohensDIndependent(offWords, onWords).toFixed(2)} |`,
    `| Structural pass rate | ${offRows.length ? ((offPass / offRows.length) * 100).toFixed(0) : "—"}% | ${onRows.length ? ((onPass / onRows.length) * 100).toFixed(0) : "—"}% | — |`,
    `| Mean duration (ms) | ${offDurations.length ? mean(offDurations).toFixed(0) : "—"} | ${onDurations.length ? mean(onDurations).toFixed(0) : "—"} | ${cohensDIndependent(offDurations, onDurations).toFixed(2)} |`,
    "",
    "Note: negative Cohen's d on word count means ON responses are longer than OFF.",
  ];

  console.log(lines.join("\n"));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
