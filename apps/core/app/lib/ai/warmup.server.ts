/**
 * Server-boot warmup for AI provider HTTPS keepalive.
 *
 * The first user message after server start pays a TCP + TLS handshake cost
 * (~200-600 ms) talking to OpenAI / Google. Firing a tiny embedding request
 * at module load establishes the connection up front so the user's first
 * real chat call reuses an already-open socket.
 *
 * Notes:
 * - Chat-completion API keys come from the *request body* (per user), so we
 *   cannot warm completions at boot. We warm the *embedding* provider keyed
 *   from `.env`. Node's HTTPS agent keys the keepalive pool by host, so a
 *   warmed connection to `api.openai.com` for embeddings still benefits
 *   chat-completion calls to the same host.
 * - Failures are non-fatal; the worst case is we paid latency for nothing.
 */

import { generateEmbedding } from "./embedding";

const SHOULD_WARM = process.env.NODE_ENV !== "test" && process.env.CHAT_DISABLE_BOOT_WARMUP !== "1";

declare global {
  var __aiWarmupStarted: boolean | undefined;
}

function hasAnyEmbeddingProvider(): boolean {
  return Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim(),
  );
}

async function warmEmbeddingProvider(): Promise<void> {
  try {
    const startedAt = Date.now();
    await generateEmbedding("warmup");
    console.log(`[warmup] embedding provider HTTPS keepalive established in ${Date.now() - startedAt} ms`);
  } catch (error) {
    console.warn("[warmup] embedding provider warmup failed (non-fatal):", error);
  }
}

if (SHOULD_WARM && !globalThis.__aiWarmupStarted) {
  globalThis.__aiWarmupStarted = true;
  if (hasAnyEmbeddingProvider()) {
    void warmEmbeddingProvider();
  } else {
    console.log("[warmup] no embedding provider configured in env; skipping HTTPS warmup");
  }
}
