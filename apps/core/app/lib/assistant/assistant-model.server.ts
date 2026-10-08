/**
 * @file One model call for the help assistant, as a closed set of outcomes (#1820).
 *
 * Goes through Core's existing provider registry — no direct HTTP to a provider.
 * The outcome distinguishes a provider that ANSWERED but refused (carrying its
 * real status separately) from a call that never completed, and both from a
 * request refused locally before any HTTP call.
 */
import { APICallError, RetryError, generateText } from "ai";

import {
  createAIProviderRegistry,
  mergeLocalInferenceFromEnv,
  type SupportedProvider,
} from "~/lib/ai/providers";
import { providerErrorDiagnostic } from "~/lib/ai/provider-errors.server";
import { FleetUnavailableError, resolveFleetHost } from "~/lib/ai/routing/fleet/resolve-fleet";
import { fleetRoutingEnabled } from "~/lib/ai/routing/fleet/registry";
import { isSafeModelId } from "~/lib/assistant/assistant-settings";
import type { AssistantTurn } from "~/lib/assistant/history";
import type { ResolvedProviderKey } from "~/lib/assistant/user-ai-keys.server";

export type AssistantModelResult =
  | { kind: "success"; text: string }
  /** Refused locally before any HTTP call (unsafe model id, unregistered provider). */
  | { kind: "invalid" }
  /** The provider answered with a non-2xx status. */
  | { kind: "upstream_error"; status: number }
  /** The call never completed (DNS, connection, timeout, fleet down). */
  | { kind: "transport_failure" };

const CALL_TIMEOUT_MS = 60_000;

/** The provider's HTTP status when it answered, or null when the call never completed. */
function upstreamStatus(cause: unknown): number | null {
  // A retried call surfaces as RetryError wrapping the last APICallError.
  const error = RetryError.isInstance(cause) ? cause.lastError : cause;
  if (APICallError.isInstance(error) && error.statusCode !== undefined) return error.statusCode;
  return null;
}

export async function callAssistantModel(input: {
  provider: SupportedProvider;
  model: string;
  key: ResolvedProviderKey;
  system?: string;
  messages: AssistantTurn[];
  maxTokens: number;
}): Promise<AssistantModelResult> {
  if (!isSafeModelId(input.model)) return { kind: "invalid" };
  const modelIdentifier: `${string}:${string}` = `${input.provider}:${input.model}`;

  let fleetBaseUrl: string | undefined;
  if (input.provider === "vllm" && fleetRoutingEnabled()) {
    try {
      fleetBaseUrl = (
        await resolveFleetHost({ jobType: "interactive", resolvedModelId: modelIdentifier })
      )?.baseUrl;
    } catch (cause) {
      if (cause instanceof FleetUnavailableError) return { kind: "transport_failure" };
      throw cause;
    }
  }

  let languageModel;
  try {
    const settings = mergeLocalInferenceFromEnv(
      { [input.provider]: { isEnabled: true, apiKey: input.key.apiKey } },
      modelIdentifier,
      fleetBaseUrl,
    );
    languageModel = createAIProviderRegistry(settings).languageModel(modelIdentifier);
  } catch {
    return { kind: "invalid" };
  }

  try {
    const { text } = await generateText({
      model: languageModel,
      system: input.system,
      messages: input.messages,
      temperature: 0.2,
      maxTokens: input.maxTokens,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    return { kind: "success", text: text.trim() };
  } catch (cause) {
    const status = upstreamStatus(cause);
    console.warn("[assistant/model] provider call failed", {
      provider: input.provider,
      model: input.model,
      upstreamStatus: status,
      diagnostic: providerErrorDiagnostic(cause).name,
    });
    return status === null ? { kind: "transport_failure" } : { kind: "upstream_error", status };
  }
}
