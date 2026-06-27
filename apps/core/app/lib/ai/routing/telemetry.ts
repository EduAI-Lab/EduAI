/**
 * Persists routing + sustainability telemetry after each LLM turn.
 */

import type { Prisma } from "@prisma/client";
import { measureTurnEnergy } from "~/lib/ai/energy/measurement.server";
import { numToRouterTier } from "./tiers";
import prisma from "~/lib/prisma.server";

export type NormalizedTokenUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

function asTokenCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

/** vLLM/LiteLLM may return zeros when stream usage was not requested. */
function isMissingUsage(
  promptTokens: number | null,
  completionTokens: number | null,
  totalTokens: number | null,
): boolean {
  if (promptTokens == null && completionTokens == null && totalTokens == null) {
    return true;
  }
  const prompt = promptTokens ?? 0;
  const completion = completionTokens ?? 0;
  const total = totalTokens ?? prompt + completion;
  return prompt === 0 && completion === 0 && total === 0;
}

/** AI SDK / OpenAI-compatible providers may use promptTokens or inputTokens. */
export function normalizeTokenUsage(
  usage: Record<string, unknown> | undefined | null,
): NormalizedTokenUsage {
  if (!usage) {
    return { promptTokens: null, completionTokens: null, totalTokens: null };
  }
  const promptTokens =
    asTokenCount(usage.promptTokens) ??
    asTokenCount(usage.inputTokens) ??
    asTokenCount(usage.prompt_tokens);
  const completionTokens =
    asTokenCount(usage.completionTokens) ??
    asTokenCount(usage.outputTokens) ??
    asTokenCount(usage.completion_tokens);
  const totalTokens =
    asTokenCount(usage.totalTokens) ??
    asTokenCount(usage.total_tokens) ??
    (promptTokens != null && completionTokens != null
      ? promptTokens + completionTokens
      : null);
  if (isMissingUsage(promptTokens, completionTokens, totalTokens)) {
    return { promptTokens: null, completionTokens: null, totalTokens: null };
  }
  return { promptTokens, completionTokens, totalTokens };
}

/** Pick the first source that yields token counts (finish hook, AI SDK usage, raw body). */
export function coalesceTokenUsage(
  ...sources: (Record<string, unknown> | undefined | null)[]
): NormalizedTokenUsage {
  for (const source of sources) {
    const normalized = normalizeTokenUsage(source);
    if (
      normalized.promptTokens != null ||
      normalized.completionTokens != null ||
      normalized.totalTokens != null
    ) {
      return normalized;
    }
  }
  return { promptTokens: null, completionTokens: null, totalTokens: null };
}

export function splitRegistryModelId(
  identifier: string,
): { providerName: string; modelId: string } | null {
  const firstColon = identifier.indexOf(":");
  if (firstColon === -1) return null;
  const providerName = identifier.slice(0, firstColon);
  const modelId = identifier.slice(firstColon + 1);
  if (!providerName || !modelId) return null;
  return { providerName, modelId };
}

export async function persistAiInteractionTelemetry(params: {
  userId: string;
  courseId: string | null;
  resolvedModelId: string;
  query: string;
  responseText: string;
  usage:
    | {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
      }
    | undefined;
  finishReason: string;
  durationMs: number;
  wasAuto: boolean;
  routingTier: 1 | 2 | 3 | null;
  routerVersion: string | null;
  routerFeatures: Record<string, unknown> | null;
  energySidecarBaseUrl?: string | null;
}): Promise<void> {
  try {
    const parsed = splitRegistryModelId(params.resolvedModelId);
    const modelRecord = parsed
      ? await prisma.aIModel.findFirst({
          where: {
            modelId: parsed.modelId,
            provider: { name: parsed.providerName },
            isActive: true,
          },
        })
      : null;

    const { promptTokens, completionTokens, totalTokens } = normalizeTokenUsage(
      params.usage as Record<string, unknown> | undefined,
    );

    let estInputCostUsd: number | null = null;
    let estOutputCostUsd: number | null = null;
    if (modelRecord?.inputPricing != null && promptTokens != null) {
      estInputCostUsd = (promptTokens / 1_000_000) * modelRecord.inputPricing;
    }
    if (modelRecord?.outputPricing != null && completionTokens != null) {
      estOutputCostUsd = (completionTokens / 1_000_000) * modelRecord.outputPricing;
    }

    const energy = await measureTurnEnergy(
      {
        registryModelId: params.resolvedModelId,
        promptTokens,
        completionTokens,
        durationMs: params.durationMs,
        estEnergyJoulesPerToken: modelRecord?.estEnergyJoulesPerToken ?? null,
        averageCarbonGramsPerToken: modelRecord?.averageCarbonGramsPerToken ?? null,
      },
      { sidecarBaseUrl: params.energySidecarBaseUrl },
    );

    await prisma.aIInteraction.create({
      data: {
        userId: params.userId,
        courseId: params.courseId,
        modelId: modelRecord?.id ?? null,
        modelUsed: params.resolvedModelId,
        query: params.query,
        response: params.responseText,
        promptTokens,
        completionTokens,
        durationMs: params.durationMs,
        finishReason: params.finishReason,
        routedByAuto: params.wasAuto,
        routerVersion: params.routerVersion,
        routerFeatures: params.routerFeatures
          ? (JSON.parse(JSON.stringify(params.routerFeatures)) as Prisma.InputJsonValue)
          : undefined,
        routerChosenTier:
          params.wasAuto && params.routingTier != null
            ? numToRouterTier(params.routingTier)
            : null,
        estInputCostUsd,
        estOutputCostUsd,
        energyJoules: energy.energyJoules,
        energySource: energy.energySource,
        carbonGramsCO2: energy.carbonGramsCO2,
      },
    });
  } catch (err) {
    console.error("telemetry write failed", err);
  }
}
