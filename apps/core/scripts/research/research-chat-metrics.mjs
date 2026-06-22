/**
 * Shared metrics extraction for research / #501 chat runs.
 * Pairs with `rag` telemetry on non-streaming /api/chat responses.
 */

export function readRunProvenance() {
  const pipeline = process.env.RESEARCH_PIPELINE_LABEL?.trim();
  const gitSha = process.env.RESEARCH_GIT_SHA?.trim();
  return {
    pipeline_label: pipeline || null,
    git_sha: gitSha || null,
  };
}

function headerGet(headers, name) {
  if (!headers?.get) return null;
  return headers.get(name) ?? headers.get(name.toLowerCase());
}

/** @param {Record<string, unknown>|null} json */
export function extractRagTelemetry(json, headers) {
  const rag = json?.rag;
  if (rag && typeof rag === "object") {
    return {
      rag_chunk_count: numOrNull(rag.chunkCount),
      rag_top_similarity: numOrNull(rag.topSimilarity),
      rag_injected: boolOrNull(rag.injected),
      rag_needed: boolOrNull(rag.needed),
      rag_context_chars: numOrNull(rag.contextChars),
      chat_approach: typeof rag.approach === "string" ? rag.approach : null,
    };
  }

  const chunkHeader = headerGet(headers, "X-Rag-Chunk-Count");
  const simHeader = headerGet(headers, "X-Rag-Top-Similarity");
  const injectHeader = headerGet(headers, "X-Rag-Injected");
  const approachHeader = headerGet(headers, "X-Chat-Approach");

  return {
    rag_chunk_count: chunkHeader != null ? Number(chunkHeader) : null,
    rag_top_similarity: simHeader != null ? Number(simHeader) : null,
    rag_injected: injectHeader === "1" ? true : injectHeader === "0" ? false : null,
    rag_needed: null,
    rag_context_chars: null,
    chat_approach: approachHeader || null,
  };
}

/** @param {Record<string, unknown>|null} json */
export function extractUsageTokens(json) {
  const usage = json?.usage;
  if (!usage || typeof usage !== "object") {
    return { prompt_tokens: null, completion_tokens: null, total_tokens: null };
  }
  const prompt =
    usage.promptTokens ?? usage.inputTokens ?? usage.prompt_tokens ?? null;
  const completion =
    usage.completionTokens ?? usage.outputTokens ?? usage.completion_tokens ?? null;
  const p = numOrNull(prompt);
  const c = numOrNull(completion);
  const total = p != null && c != null ? p + c : p ?? c;
  return {
    prompt_tokens: p,
    completion_tokens: c,
    total_tokens: total,
  };
}

export function computeEfficiencyMetrics({
  energy_joules,
  prompt_tokens,
  completion_tokens,
  duration_ms,
  response_chars,
}) {
  const p = numOrNull(prompt_tokens);
  const c = numOrNull(completion_tokens);
  const totalTokens = p != null && c != null ? p + c : null;
  const joules = numOrNull(energy_joules);
  const ms = numOrNull(duration_ms);
  const chars = numOrNull(response_chars);

  return {
    response_chars: chars,
    total_tokens: totalTokens,
    joules_per_token:
      joules != null && totalTokens != null && totalTokens > 0
        ? Math.round((joules / totalTokens) * 10000) / 10000
        : null,
    ms_per_completion_token:
      ms != null && c != null && c > 0 ? Math.round((ms / c) * 10) / 10 : null,
  };
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function boolOrNull(v) {
  if (v === true || v === false) return v;
  return null;
}

export function summarizeRagRows(rows) {
  const withCourse = rows.filter((r) => r.course_code);
  const injected = withCourse.filter((r) => r.rag_injected === true);
  const sims = withCourse
    .map((r) => r.rag_top_similarity)
    .filter((v) => v != null && Number.isFinite(v));
  const chunks = withCourse
    .map((r) => r.rag_chunk_count)
    .filter((v) => v != null && Number.isFinite(v));

  return {
    course_prompts: withCourse.length,
    rag_inject_count: injected.length,
    rag_inject_rate_pct:
      withCourse.length > 0
        ? Math.round((injected.length / withCourse.length) * 100)
        : null,
    mean_top_similarity:
      sims.length > 0
        ? Math.round((sims.reduce((a, b) => a + b, 0) / sims.length) * 1000) / 1000
        : null,
    mean_chunk_count:
      chunks.length > 0
        ? Math.round((chunks.reduce((a, b) => a + b, 0) / chunks.length) * 10) / 10
        : null,
  };
}
