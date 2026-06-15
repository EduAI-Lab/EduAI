import type { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import {
  computeAdhdResponseMetrics,
  withStructuralPass,
  type AdhdResponseMetrics,
} from "~/lib/ai/adhd-metrics";

/** Server-written after each assistant turn. */
export const ASSISTIVE_EVENT_RESPONSE_COMPLIANCE = "response_compliance" as const;

/** Client-written UI interaction events (derived metrics only — never message text). */
export const ASSISTIVE_CLIENT_EVENT_TYPES = [
  "mode_toggled",
  "expand_click",
  "task_initiation",
  "re_orientation",
  "session_completion",
] as const;

export type AssistiveClientEventType = (typeof ASSISTIVE_CLIENT_EVENT_TYPES)[number];

export type AssistiveEventType =
  | typeof ASSISTIVE_EVENT_RESPONSE_COMPLIANCE
  | AssistiveClientEventType;

export type RecordAssistiveEventInput = {
  userId: string;
  chatId?: string | null;
  adhdAssist: boolean;
  eventType: AssistiveEventType;
  metricsJson: Prisma.InputJsonValue;
};

export async function recordAssistiveEvent(
  input: RecordAssistiveEventInput,
): Promise<void> {
  await prisma.assistiveEvent.create({
    data: {
      userId: input.userId,
      chatId: input.chatId ?? null,
      adhdAssist: input.adhdAssist,
      eventType: input.eventType,
      metricsJson: input.metricsJson,
    },
  });
}

export type ResponseComplianceExtras = {
  model?: string;
  finishReason?: string | null;
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  wordCap?: number;
  oversightRewritten?: boolean;
  oversightMethod?: "none" | "deterministic" | "llm" | "llm_failed";
  preStructuralPass?: boolean;
  oversightDurationMs?: number;
  oversightPromptTokens?: number;
  oversightCompletionTokens?: number;
};

export async function recordResponseComplianceEvent(args: {
  userId: string;
  chatId: string;
  adhdAssist: boolean;
  assistantText: string;
  extras?: ResponseComplianceExtras;
}): Promise<void> {
  const metrics = withStructuralPass(
    computeAdhdResponseMetrics(args.assistantText, {
      wordCap: args.extras?.wordCap,
    }),
  );
  const payload: Prisma.InputJsonValue = {
    ...metrics,
    model: args.extras?.model ?? null,
    finishReason: args.extras?.finishReason ?? null,
    promptTokens: args.extras?.promptTokens ?? null,
    completionTokens: args.extras?.completionTokens ?? null,
    durationMs: args.extras?.durationMs ?? null,
    oversightRewritten: args.extras?.oversightRewritten ?? null,
    oversightMethod: args.extras?.oversightMethod ?? null,
    preStructuralPass: args.extras?.preStructuralPass ?? null,
    oversightDurationMs: args.extras?.oversightDurationMs ?? null,
    oversightPromptTokens: args.extras?.oversightPromptTokens ?? null,
    oversightCompletionTokens: args.extras?.oversightCompletionTokens ?? null,
  };

  await recordAssistiveEvent({
    userId: args.userId,
    chatId: args.chatId,
    adhdAssist: args.adhdAssist,
    eventType: ASSISTIVE_EVENT_RESPONSE_COMPLIANCE,
    metricsJson: payload,
  });
}

export function isAssistiveClientEventType(
  value: string,
): value is AssistiveClientEventType {
  return (ASSISTIVE_CLIENT_EVENT_TYPES as readonly string[]).includes(value);
}

export function sanitizeClientMetrics(
  metrics: unknown,
): Prisma.InputJsonValue {
  if (metrics == null || typeof metrics !== "object" || Array.isArray(metrics)) {
    return {};
  }

  const raw = metrics as Record<string, unknown>;
  const allowed = [
    "durationMs",
    "success",
    "path",
    "elementId",
    "expandTarget",
    "fromMode",
    "toMode",
    "clientTimestamp",
  ] as const;

  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = raw[key];
    if (value === undefined) continue;
    if (key === "durationMs" && typeof value === "number" && Number.isFinite(value)) {
      out[key] = Math.max(0, Math.round(value));
      continue;
    }
    if (key === "success" && typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (
      (key === "path" || key === "elementId" || key === "expandTarget") &&
      typeof value === "string" &&
      value.length <= 200
    ) {
      out[key] = value;
      continue;
    }
    if (key === "fromMode" || key === "toMode") {
      if (value === true || value === false) out[key] = value;
      continue;
    }
    if (key === "clientTimestamp" && typeof value === "string" && value.length <= 40) {
      out[key] = value;
    }
  }

  return out as Prisma.InputJsonValue;
}

export type { AdhdResponseMetrics };
