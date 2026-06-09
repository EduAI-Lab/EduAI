/**
 * Persists routing + sustainability telemetry after each LLM turn.
 */

import type { Prisma } from "@prisma/client";
import { measureTurnEnergy } from "~/lib/ai/energy/measurement.server";
import { numToRouterTier } from "./tiers";
import prisma from "~/lib/prisma.server";

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

    const promptTokens = params.usage?.promptTokens ?? null;
    const completionTokens = params.usage?.completionTokens ?? null;
    const totalTokens =
      params.usage?.totalTokens ??
      (promptTokens != null && completionTokens != null
        ? promptTokens + completionTokens
        : null);

    let estInputCostUsd: number | null = null;
    let estOutputCostUsd: number | null = null;
    if (modelRecord?.inputPricing != null && promptTokens != null) {
      estInputCostUsd = (promptTokens / 1_000_000) * modelRecord.inputPricing;
    }
    if (modelRecord?.outputPricing != null && completionTokens != null) {
      estOutputCostUsd = (completionTokens / 1_000_000) * modelRecord.outputPricing;
    }

    const energy = await measureTurnEnergy({
      registryModelId: params.resolvedModelId,
      promptTokens,
      completionTokens,
      durationMs: params.durationMs,
      estEnergyJoulesPerToken: modelRecord?.estEnergyJoulesPerToken ?? null,
      averageCarbonGramsPerToken: modelRecord?.averageCarbonGramsPerToken ?? null,
    });

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
