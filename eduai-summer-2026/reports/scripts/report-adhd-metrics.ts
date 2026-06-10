#!/usr/bin/env tsx
/**
 * Research reporting: aggregate AssistiveEvent rows for OFF vs ON before/after analysis.
 * Lives outside apps/core so production deploys stay free of research tooling.
 *
 * Reports the server-written `response_compliance` event plus the #521 client
 * behavioural events (task_initiation, re_orientation, session_completion). Pass
 * `--event <type>` to scope the report to a single event type.
 *
 * Run from apps/core (needs DATABASE_URL + generated Prisma client):
 *   cd apps/core
 *   npx tsx ../../eduai-summer-2026/reports/scripts/report-adhd-metrics.ts
 *   npx tsx ../../eduai-summer-2026/reports/scripts/report-adhd-metrics.ts --since 2026-06-09
 *   npx tsx ../../eduai-summer-2026/reports/scripts/report-adhd-metrics.ts --event task_initiation
 */

import { PrismaClient } from "@prisma/client";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const prisma = new PrismaClient();

/** Server-written after each assistant turn — carries word-count/structural metrics. */
const RESPONSE_COMPLIANCE = "response_compliance";

/** #521 client UI events — carry behavioural metrics (durationMs/success), never text. */
const BEHAVIORAL_EVENT_TYPES = [
  "task_initiation",
  "re_orientation",
  "session_completion",
] as const;

const REPORTED_EVENT_TYPES = [RESPONSE_COMPLIANCE, ...BEHAVIORAL_EVENT_TYPES];

type ComplianceRow = {
  wordCount: number;
  structuralPass: boolean;
  durationMs: number | null;
};

type BehavioralRow = {
  durationMs: number | null;
  success: boolean | null;
};

type EventRow = { adhdAssist: boolean; metricsJson: unknown };

function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
}

/** Independent-samples Cohen's d (OFF vs ON). NaN when either side has <2 samples. */
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

/** Render a number, or an em dash when it is NaN/non-finite (e.g. an empty cohort). */
export function fmt(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

/** Render a percentage, or an em dash when there is nothing to divide by. */
export function pct(count: number, total: number): string {
  return total > 0 ? `${((count / total) * 100).toFixed(0)}%` : "—";
}

function asMetrics(metricsJson: unknown): Record<string, unknown> | null {
  if (!metricsJson || typeof metricsJson !== "object" || Array.isArray(metricsJson)) {
    return null;
  }
  return metricsJson as Record<string, unknown>;
}

function parseCompliance(metricsJson: unknown): ComplianceRow | null {
  const m = asMetrics(metricsJson);
  if (!m || typeof m.wordCount !== "number") return null;
  return {
    wordCount: m.wordCount,
    structuralPass: Boolean(m.structuralPass),
    durationMs: typeof m.durationMs === "number" ? m.durationMs : null,
  };
}

function parseBehavioral(metricsJson: unknown): BehavioralRow {
  const m = asMetrics(metricsJson);
  return {
    durationMs: m && typeof m.durationMs === "number" ? m.durationMs : null,
    success: m && typeof m.success === "boolean" ? m.success : null,
  };
}

async function fetchEvents(eventType: string, since?: Date): Promise<EventRow[]> {
  return prisma.assistiveEvent.findMany({
    where: {
      eventType,
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    select: { adhdAssist: true, metricsJson: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

/** response_compliance: word count, structural-pass rate, response duration. */
export function complianceSection(eventType: string, events: EventRow[]): string[] {
  const off: ComplianceRow[] = [];
  const on: ComplianceRow[] = [];
  for (const e of events) {
    const row = parseCompliance(e.metricsJson);
    if (!row) continue;
    (e.adhdAssist ? on : off).push(row);
  }

  const offWords = off.map((r) => r.wordCount);
  const onWords = on.map((r) => r.wordCount);
  const offPass = off.filter((r) => r.structuralPass).length;
  const onPass = on.filter((r) => r.structuralPass).length;
  const offDur = off.map((r) => r.durationMs).filter((v): v is number => v != null);
  const onDur = on.map((r) => r.durationMs).filter((v): v is number => v != null);

  return [
    `## ${eventType}`,
    "",
    `Rows: ${off.length + on.length} (OFF n=${off.length}, ON n=${on.length})`,
    "",
    "| Metric | OFF | ON | Cohen's d (OFF−ON) |",
    "| --- | ---: | ---: | ---: |",
    `| Mean word count | ${fmt(mean(offWords), 1)} | ${fmt(mean(onWords), 1)} | ${fmt(cohensDIndependent(offWords, onWords), 2)} |`,
    `| Structural pass rate | ${pct(offPass, off.length)} | ${pct(onPass, on.length)} | — |`,
    `| Mean duration (ms) | ${fmt(mean(offDur), 0)} | ${fmt(mean(onDur), 0)} | ${fmt(cohensDIndependent(offDur, onDur), 2)} |`,
    "",
    "Note: negative Cohen's d on word count means ON responses are longer than OFF.",
  ];
}

/** Behavioural client events: event count, success rate, interaction duration. */
export function behavioralSection(eventType: string, events: EventRow[]): string[] {
  const off: BehavioralRow[] = [];
  const on: BehavioralRow[] = [];
  for (const e of events) {
    (e.adhdAssist ? on : off).push(parseBehavioral(e.metricsJson));
  }

  const offDur = off.map((r) => r.durationMs).filter((v): v is number => v != null);
  const onDur = on.map((r) => r.durationMs).filter((v): v is number => v != null);
  const offSucc = off.filter((r) => r.success === true).length;
  const onSucc = on.filter((r) => r.success === true).length;
  const offSuccTotal = off.filter((r) => r.success !== null).length;
  const onSuccTotal = on.filter((r) => r.success !== null).length;

  return [
    `## ${eventType}`,
    "",
    `Rows: ${off.length + on.length} (OFF n=${off.length}, ON n=${on.length})`,
    "",
    "| Metric | OFF | ON | Cohen's d (OFF−ON) |",
    "| --- | ---: | ---: | ---: |",
    `| Event count | ${off.length} | ${on.length} | — |`,
    `| Success rate | ${pct(offSucc, offSuccTotal)} | ${pct(onSucc, onSuccTotal)} | — |`,
    `| Mean duration (ms) | ${fmt(mean(offDur), 0)} | ${fmt(mean(onDur), 0)} | ${fmt(cohensDIndependent(offDur, onDur), 2)} |`,
  ];
}

async function main() {
  const { values } = parseArgs({
    options: {
      since: { type: "string" },
      event: { type: "string" },
    },
  });

  const since = values.since ? new Date(values.since) : undefined;
  const eventTypes = values.event ? [values.event] : REPORTED_EVENT_TYPES;

  const sections: string[] = [];
  for (const eventType of eventTypes) {
    const events = await fetchEvents(eventType, since);
    const section =
      eventType === RESPONSE_COMPLIANCE
        ? complianceSection(eventType, events)
        : behavioralSection(eventType, events);
    sections.push(section.join("\n"));
  }

  const lines = [
    "# ADHD Assist telemetry",
    since ? `Since: ${since.toISOString()}` : "Since: (all time)",
    "",
    sections.join("\n\n"),
  ];

  console.log(lines.join("\n"));
}

function run() {
  return main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

// Run only when invoked directly (e.g. `tsx report-adhd-metrics.ts`), not when
// imported — so the section builders can be unit-tested without a database.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void run();
}
