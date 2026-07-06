/** Parse routing timeline fields from /api/chat JSON + response headers. */

function headerInt(headers, name) {
  if (!headers) return null;
  const raw =
    typeof headers.get === "function"
      ? headers.get(name)
      : headers[name] ?? headers[name.toLowerCase()];
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function extractRoutingMetrics(json, headers) {
  const routing = json?.routing && typeof json.routing === "object" ? json.routing : {};
  const fromJson = {
    router_rule: routing.router_rule ?? json?.router_rule ?? null,
    routing_tier: routing.routing_tier ?? json?.routing_tier ?? null,
    router_version: routing.router_version ?? json?.router_version ?? null,
    routed_model: routing.routed_model ?? json?.routedModel ?? json?.model ?? null,
    rag_prefetch_ms: routing.rag_prefetch_ms ?? json?.rag_prefetch_ms ?? null,
    route_resolve_ms: routing.route_resolve_ms ?? json?.route_resolve_ms ?? null,
    route_classify_ms: routing.route_classify_ms ?? json?.route_classify_ms ?? null,
    model_decode_ms: routing.model_decode_ms ?? json?.model_decode_ms ?? null,
    duration_ms: routing.duration_ms ?? json?.duration_ms ?? null,
  };

  const headerString = (headers, name) => {
    if (!headers) return null;
    const raw =
      typeof headers.get === "function"
        ? headers.get(name)
        : headers[name] ?? headers[name.toLowerCase()];
    return raw != null && raw !== "" ? String(raw) : null;
  };

  const fromHeaders = {
    router_rule: headerString(headers, "x-router-rule"),
    routing_tier: headerInt(headers, "x-routing-tier"),
    router_version:
      (typeof headers?.get === "function"
        ? headers.get("x-router-version")
        : headers?.["x-router-version"]) ?? null,
    routed_model:
      (typeof headers?.get === "function"
        ? headers.get("x-routed-model")
        : headers?.["x-routed-model"]) ?? null,
    rag_prefetch_ms: headerInt(headers, "x-rag-prefetch-ms"),
    route_resolve_ms: headerInt(headers, "x-route-resolve-ms"),
    route_classify_ms: headerInt(headers, "x-route-classify-ms"),
    model_decode_ms: headerInt(headers, "x-model-decode-ms"),
    duration_ms: headerInt(headers, "x-chat-duration-ms"),
  };

  const merged = { ...fromJson };
  for (const [key, value] of Object.entries(fromHeaders)) {
    if (merged[key] == null && value != null) {
      merged[key] = value;
    }
  }
  return merged;
}

export function flattenRoutingFields(metrics) {
  if (!metrics) return {};
  return {
    router_rule: metrics.router_rule ?? null,
    rag_prefetch_ms: metrics.rag_prefetch_ms ?? null,
    route_resolve_ms: metrics.route_resolve_ms ?? null,
    route_classify_ms: metrics.route_classify_ms ?? null,
    model_decode_ms: metrics.model_decode_ms ?? null,
    timeline_duration_ms: metrics.duration_ms ?? null,
  };
}
