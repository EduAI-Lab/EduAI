/**
 * Persists routing + sustainability telemetry after each LLM turn.
 */

import type { Prisma } from "@prisma/client";
import { measureTurnEnergy } from "~/lib/ai/energy/measurement.server";
import { numToRouterTier } from "./tiers";
import prisma from "~/lib/prisma.server";
import { normalizeTokenUsage, splitRegistryModelId } from "./telemetry";

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
  /** Tagged sidecar session started before inference in /api/chat. */
  sidecarTag?: string | null;
  /** Per-host sidecar base URL (fleet routing); falls back to ENERGY_SIDECAR_URL. */
  energySidecarBaseUrl?: string | null;
  /** Fleet server id (e.g. "cmps01") that served this turn; null when not fleet-routed. */
  serverId?: string | null;
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
        totalTokens,
        durationMs: params.durationMs,
        estEnergyJoulesPerToken: modelRecord?.estEnergyJoulesPerToken ?? null,
        averageCarbonGramsPerToken: modelRecord?.averageCarbonGramsPerToken ?? null,
      },
      {
        sidecarTag: params.sidecarTag,
        sidecarBaseUrl: params.energySidecarBaseUrl,
      },
    );

    await prisma.aIInteraction.create({
      data: {
        userId: params.userId,
        courseId: params.courseId,
        modelId: modelRecord?.id ?? null,
        modelUsed: params.resolvedModelId,
        serverId: params.serverId ?? null,
        query: params.query,
        response: params.responseText,
        promptTokens,
        completionTokens,
        totalTokens,
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
