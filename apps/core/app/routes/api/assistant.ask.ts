/**
 * `POST /api/assistant/ask` — the help assistant's grounded answer (#1820).
 *
 * Authenticated, throttled at 10 questions/min per user: tighter than chat on
 * purpose, because one question can be two upstream calls (follow-up rewriting
 * plus the answer), so 10/min already allows chat's worst-case upstream rate
 * rather than doubling it.
 *
 * The request has NO key field — the schema is strict, so a pasted key is a 422,
 * never a way to widen the caller's own key scope. Any course/material id is a
 * hint the pipeline re-validates against this reader's own access.
 *
 * Status contract (each row has a test in assistant-ask.route.test.ts):
 *   200 {answer, sources, scope}              answered, grounded or a fixed sentence
 *   403 {error, code: "unavailable"}          neither source applies here
 *   404 {error}                               the hint names nothing real and docs are off
 *   422 {error, code: "no_key"}               a source applies, no key resolves
 *   422 {error, code: "provider_invalid"}     refused locally before any HTTP call
 *   422 {error: "VALIDATION_ERROR", errors}   request shape failed
 *   429 {error, code: "rate_limited"}         this endpoint's own throttle
 *   429 {error, code: "daily_limit"}          a local model's shared daily cap (chat's)
 *   502 {error, code: "provider_error", upstream_status}  provider answered, refused
 *   502 {error, code: "provider_unreachable"} transport failure
 *   503 {error, code: "retrieval_unavailable"} the documentation search is down
 *   503 {error, code: "provider_busy"}        no local-inference slot freed up in time
 *
 * A provider's own status is never passed through: a provider 401/403/429 would be
 * indistinguishable from this endpoint's own, so it is always 502 with the real
 * status carried as `upstream_status`.
 */
import { z } from "zod";
import type { ActionFunctionArgs } from "react-router";

import { admissionRetryAfterSeconds } from "~/lib/ai/admission.server";
import { answerAssistantQuestion, type AskOutcome } from "~/lib/assistant/ask.server";
import { ASSISTANT_DISPLAY_NAME } from "~/lib/assistant/assistant-settings";
import { parsePageContextHint } from "~/lib/assistant/material-context.server";
import {
  jsonResponse as json,
  requireSessionUser,
  throttle,
} from "~/lib/assistant/route-helpers.server";
import { parseEnvInt } from "~/lib/auth/rate-limit.server";
import { readBoundedJson } from "~/lib/chat-input.server";
import { withErrorResponse } from "~/lib/errors.server";

export const ASK_QUESTION_MAX_CHARS = 2_000;
export const ASK_HISTORY_MAX_TURNS = 20;
export const ASK_TURN_MAX_CHARS = 4_000;
export const ASK_CONTEXT_MAX_ENTRIES = 3;
export const ASK_CONTEXT_VALUE_MAX_CHARS = 100;
const ASK_MAX_BODY_BYTES = 160 * 1024;

const turnSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(ASK_TURN_MAX_CHARS),
  })
  .strict();

export const askRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(ASK_QUESTION_MAX_CHARS),
    history: z.array(turnSchema).max(ASK_HISTORY_MAX_TURNS).nullish(),
    context: z
      .record(z.string().max(32), z.string().max(ASK_CONTEXT_VALUE_MAX_CHARS))
      .refine((value) => Object.keys(value).length <= ASK_CONTEXT_MAX_ENTRIES, {
        message: `At most ${ASK_CONTEXT_MAX_ENTRIES} context entries`,
      })
      .nullish(),
  })
  .strict();

/** A busy provider or a spent quota is not a key problem, so only the rest point at the key. */
function providerErrorMessage(status: number, keyHint: string): string {
  if (status >= 500) {
    return `The AI provider is overloaded or having trouble right now (status ${status}). Please try again in a moment.`;
  }
  if (status === 429) {
    return `The AI provider is rate-limiting this key or its quota is used up (status 429). Wait a minute and try again; if it keeps happening, check ${keyHint}.`;
  }
  return `The AI provider refused the request (status ${status}). If this keeps happening, check ${keyHint}.`;
}

function askOutcomeResponse(outcome: AskOutcome): Response {
  switch (outcome.kind) {
    case "answered":
      return json(200, { answer: outcome.answer, sources: outcome.sources, scope: outcome.scope });
    case "unavailable":
      return json(403, {
        error: `${ASSISTANT_DISPLAY_NAME} isn't available here.`,
        code: "unavailable",
      });
    case "not_found":
      return json(404, { error: "The course or material this page refers to was not found." });
    case "no_key":
      return json(422, {
        error:
          "No AI provider key is available for you. Add your own key in the assistant's settings, or ask an administrator to configure one.",
        code: "no_key",
      });
    case "provider_invalid":
      return json(422, {
        error: "The selected model can't be used. Pick another model in the assistant's settings.",
        code: "provider_invalid",
      });
    case "retrieval_unavailable":
      return json(503, {
        error: `${ASSISTANT_DISPLAY_NAME} is temporarily unavailable — the documentation search isn't responding. Please try again later.`,
        code: "retrieval_unavailable",
      });
    case "provider_error":
      return json(502, {
        error: providerErrorMessage(outcome.upstreamStatus, outcome.keyHint),
        code: "provider_error",
        upstream_status: outcome.upstreamStatus,
      });
    case "provider_unreachable":
      return json(502, {
        error: "The AI provider couldn't be reached. Please try again in a moment.",
        code: "provider_unreachable",
      });
    case "provider_busy": {
      const retryAfter = admissionRetryAfterSeconds();
      return json(
        503,
        {
          error: "The AI service is busy with other requests. Please try again shortly.",
          code: "provider_busy",
          retryAfter,
        },
        { "Retry-After": String(retryAfter) },
      );
    }
    case "daily_limited":
      return json(
        429,
        {
          error: "You've reached today's limit for questions to the local AI model.",
          code: "daily_limit",
          retryAfter: outcome.retryAfter,
        },
        { "Retry-After": String(outcome.retryAfter) },
      );
  }
}

export async function action({ request }: ActionFunctionArgs) {
  return withErrorResponse(
    async () => {
      if (request.method !== "POST") return json(405, { error: "Method not allowed" });

      const user = await requireSessionUser(request);
      if (!user) return json(401, { error: "Unauthorized" });

      const limit = parseEnvInt(process.env.ASSISTANT_ASK_RATE_LIMIT, 10);
      const limited = await throttle("assistant-ask", user.id, limit);
      if (limited) return limited;

      const body = await readBoundedJson(
        request,
        ASK_MAX_BODY_BYTES,
        "Assistant request body exceeds size limit",
      );
      if (!body.ok) return json(body.status, { error: body.error });

      const parsed = askRequestSchema.safeParse(body.body);
      if (!parsed.success) {
        return json(422, { error: "VALIDATION_ERROR", errors: parsed.error.flatten() });
      }

      const outcome = await answerAssistantQuestion({
        user: { id: user.id, role: user.role },
        question: parsed.data.question,
        history: parsed.data.history ?? [],
        hint: parsePageContextHint(parsed.data.context),
      });
      return askOutcomeResponse(outcome);
    },
    { request },
  );
}
