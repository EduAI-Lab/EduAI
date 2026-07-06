/**
 * Auto routing for /api/chat — RAG prefetch for router signals + tier decision + timing.
 */
import { needsCourseRag } from "~/lib/ai/chat-intent";
import { findRelevantContent } from "~/lib/ai/embedding";
import { HYBRID_RAG_MAX_CHUNKS } from "~/lib/chat-rag";
import {
  activeRouterVersion,
  parseRouterMode,
  resolveRoutedModel,
  type RouterMode,
} from "./router";

export type ChatRoutingTiming = {
  rag_prefetch_ms: number;
  route_resolve_ms: number;
  route_classify_ms: number;
};

export type ChatRoutingResult = {
  modelId: string;
  tier: 1 | 2 | 3;
  wasAuto: boolean;
  routerVersion: string | null;
  routerRule: string | null;
  routerFeatures: Record<string, unknown>;
  timing: ChatRoutingTiming;
};

export async function resolveChatAutoRouting(params: {
  prompt: string;
  courseId: string | null;
  courseCode: string | null;
  imagesPresent: boolean;
  modeOverride?: RouterMode;
  requestedAuto: string | null;
}): Promise<ChatRoutingResult> {
  const hasCourse = Boolean(params.courseId);
  const courseRagNeeded = needsCourseRag(params.prompt, hasCourse);

  let ragTopSimilarity: number | null = null;
  let ragChunkCount: number | null = null;
  let ragContextTokenEstimate: number | null = null;

  const ragT0 = performance.now();
  if (params.courseId && params.prompt.trim().length > 0) {
    try {
      const ragPrefetch = await findRelevantContent(
        params.prompt,
        params.courseId,
        HYBRID_RAG_MAX_CHUNKS,
      );
      ragChunkCount = ragPrefetch.length;
      ragTopSimilarity = ragPrefetch[0]?.similarity ?? null;
      ragContextTokenEstimate = ragPrefetch.reduce(
        (acc, hit) => acc + Math.ceil(hit.content.length / 4),
        0,
      );
    } catch {
      /* router prefetch is best-effort */
    }
  }
  const ragPrefetchMs = Math.round(performance.now() - ragT0);

  const routeT0 = performance.now();
  const decision = await resolveRoutedModel(
    params.prompt,
    {
      courseId: params.courseId,
      courseCode: params.courseCode,
      imagesPresent: params.imagesPresent,
      ragTopSimilarity,
      ragChunkCount,
      ragContextTokenEstimate,
      courseRagNeeded,
    },
    params.modeOverride ? { modeOverride: params.modeOverride } : undefined,
  );
  const routeResolveMs =
    typeof decision.routeResolveMs === "number"
      ? decision.routeResolveMs
      : Math.round(performance.now() - routeT0);

  const routeClassifyMs =
    typeof decision.routeClassifyMs === "number" ? decision.routeClassifyMs : 0;

  const routerVersion =
    typeof decision.features.routerVersion === "string"
      ? decision.features.routerVersion
      : activeRouterVersion(
          params.modeOverride ?? parseRouterMode(process.env.ROUTER_MODE),
        );

  const routerRule =
    typeof decision.features.rule === "string" ? decision.features.rule : null;

  const routerFeatures: Record<string, unknown> = {
    ...decision.features,
    requestedAuto: params.requestedAuto,
    rag_prefetch_ms: ragPrefetchMs,
    route_resolve_ms: routeResolveMs,
    route_classify_ms: routeClassifyMs,
  };

  return {
    modelId: decision.modelId,
    tier: decision.tier,
    wasAuto: true,
    routerVersion,
    routerRule,
    routerFeatures,
    timing: {
      rag_prefetch_ms: ragPrefetchMs,
      route_resolve_ms: routeResolveMs,
      route_classify_ms: routeClassifyMs,
    },
  };
}

export function buildRoutingResponsePayload(params: {
  timing: ChatRoutingTiming;
  modelDecodeMs: number;
  durationMs: number;
  routerRule: string | null;
  routingTier: 1 | 2 | 3 | null;
  routerVersion: string | null;
  routedModel: string;
}) {
  return {
    router_rule: params.routerRule,
    routing_tier: params.routingTier,
    router_version: params.routerVersion,
    routed_model: params.routedModel,
    rag_prefetch_ms: params.timing.rag_prefetch_ms,
    route_resolve_ms: params.timing.route_resolve_ms,
    route_classify_ms: params.timing.route_classify_ms,
    model_decode_ms: params.modelDecodeMs,
    duration_ms: params.durationMs,
  };
}

export function autoRoutingHeaders(params: {
  resolvedModelId: string;
  routingTier: 1 | 2 | 3 | null;
  wasAuto: boolean;
  routerVersion?: string | null;
  routerRule?: string | null;
  fleetServerId?: string | null;
  timing?: ChatRoutingTiming;
  modelDecodeMs?: number;
  durationMs?: number;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Routed-Model": params.resolvedModelId,
  };
  if (params.fleetServerId) {
    headers["X-Fleet-Server"] = params.fleetServerId;
  }
  if (params.wasAuto) {
    if (params.routingTier != null) {
      headers["X-Routing-Tier"] = String(params.routingTier);
    }
    if (params.routerVersion) {
      headers["X-Router-Version"] = params.routerVersion;
    }
    if (params.routerRule) {
      headers["X-Router-Rule"] = params.routerRule;
    }
    if (params.timing) {
      headers["X-Rag-Prefetch-Ms"] = String(params.timing.rag_prefetch_ms);
      headers["X-Route-Resolve-Ms"] = String(params.timing.route_resolve_ms);
      headers["X-Route-Classify-Ms"] = String(params.timing.route_classify_ms);
    }
    if (params.modelDecodeMs != null) {
      headers["X-Model-Decode-Ms"] = String(params.modelDecodeMs);
    }
    if (params.durationMs != null) {
      headers["X-Chat-Duration-Ms"] = String(params.durationMs);
    }
  }
  return headers;
}
