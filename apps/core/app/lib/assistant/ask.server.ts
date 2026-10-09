/**
 * @file The grounded answer pipeline behind `POST /api/assistant/ask` (#1820).
 *
 * Order matters and each step can end the request:
 *
 * 1. Scope — re-derived server-side from the hint; neither source → `unavailable`.
 * 2. Provider/key/model — nothing resolves → `no_key`. Never a pasted key.
 * 3. Documentation retrieval — a FAILURE returns immediately, before any answer
 *    call is billed. Found-nothing is a valid outcome, not a failure.
 * 4. Material context — wrapped: a load failure degrades to "no material context"
 *    so the docs half can still answer.
 * 5. Nothing to ground in → a fixed sentence, and the answer model is NOT called.
 * 6. The grounded answer call.
 *
 * Nothing is persisted. The audit line is an operational record, never a
 * transcript: no question, history, answer or key ever reaches it.
 */
import {
  callAssistantModel,
  type AssistantModelResult,
} from "~/lib/assistant/assistant-model.server";
import {
  loadAssistantAvailability,
  scopeFor,
  type AssistantScope,
} from "~/lib/assistant/assistant-gate.server";
import {
  HelpDocsUnavailableError,
  retrieveHelpDocs,
  type RetrievedHelpPage,
} from "~/lib/assistant/help-docs/index.server";
import {
  RETRIEVAL_HISTORY_LIMITS,
  buildAnswerMessages,
  recentTurns,
  type AssistantTurn,
} from "~/lib/assistant/history";
import {
  buildMaterialContext,
  resolvePageContext,
  scopeLabel,
  type MaterialContext,
  type PageContextHint,
} from "~/lib/assistant/material-context.server";
import {
  HELP_GUIDE_SOURCE,
  MATERIAL_NOT_COVERED_ANSWER,
  MATERIAL_UNAVAILABLE_ANSWER,
  NOT_DOCUMENTED_ANSWER,
  buildRewritePrompt,
  buildSystemPrompt,
  fallbackRetrievalQuery,
} from "~/lib/assistant/prompt";
import {
  resolveAssistantProvider,
  resolveRouterModel,
  type ProviderChoice,
} from "~/lib/assistant/provider-choice.server";
import { describeKeyTier } from "~/lib/assistant/user-ai-keys.server";

export type AssistantSource = { id: string; title: string; url: string };

/** The scope echoed to the client: which halves applied, and the material label. */
export type AnsweredScope = { docs: boolean; material: string | null };

export type AskOutcome =
  | { kind: "answered"; answer: string; sources: AssistantSource[]; scope: AnsweredScope }
  | { kind: "unavailable" }
  | { kind: "not_found" }
  | { kind: "no_key" }
  | { kind: "provider_invalid" }
  | { kind: "retrieval_unavailable" }
  | { kind: "provider_error"; upstreamStatus: number; keyHint: string }
  | { kind: "provider_unreachable" };

export type AskInput = {
  user: { id: string; role?: string | null };
  question: string;
  history: AssistantTurn[];
  hint: PageContextHint | null;
};

/** Operational record for one question. Built only from these fields, by construction. */
export type AssistantAuditLine = {
  userId: string;
  role: string | null;
  pageContext: { courseId: string; materialId: string | null } | null;
  provider: string | null;
  answerModel: string | null;
  retrievalModel: string | null;
  docChunks: number;
  materialContext: boolean;
  outcome: AskOutcome["kind"] | "answered_fixed";
};

export function buildAuditLine(input: AssistantAuditLine): AssistantAuditLine {
  // Copy field by field so nothing else a caller had in scope can ride along.
  return {
    userId: input.userId,
    role: input.role,
    pageContext: input.pageContext
      ? { courseId: input.pageContext.courseId, materialId: input.pageContext.materialId }
      : null,
    provider: input.provider,
    answerModel: input.answerModel,
    retrievalModel: input.retrievalModel,
    docChunks: input.docChunks,
    materialContext: input.materialContext,
    outcome: input.outcome,
  };
}

export type AskDependencies = {
  loadAvailability: typeof loadAssistantAvailability;
  resolvePageContext: typeof resolvePageContext;
  resolveProvider: typeof resolveAssistantProvider;
  retrieveDocs: typeof retrieveHelpDocs;
  buildMaterial: typeof buildMaterialContext;
  callModel: typeof callAssistantModel;
  log: (line: AssistantAuditLine) => void;
};

const defaultDependencies: AskDependencies = {
  loadAvailability: loadAssistantAvailability,
  resolvePageContext,
  resolveProvider: resolveAssistantProvider,
  retrieveDocs: retrieveHelpDocs,
  buildMaterial: buildMaterialContext,
  callModel: callAssistantModel,
  log: (line) => console.info("[assistant] ask", line),
};

function modelFailure(
  result: Exclude<AssistantModelResult, { kind: "success" }>,
  choice: ProviderChoice,
): AskOutcome {
  switch (result.kind) {
    case "invalid":
      return { kind: "provider_invalid" };
    case "upstream_error":
      return {
        kind: "provider_error",
        upstreamStatus: result.status,
        keyHint: describeKeyTier(choice.key.tier),
      };
    case "transport_failure":
      return { kind: "provider_unreachable" };
  }
}

export async function answerAssistantQuestion(
  input: AskInput,
  deps: AskDependencies = defaultDependencies,
): Promise<AskOutcome> {
  const audit: AssistantAuditLine = {
    userId: input.user.id,
    role: input.user.role ?? null,
    pageContext: input.hint,
    provider: null,
    answerModel: null,
    retrievalModel: null,
    docChunks: 0,
    materialContext: false,
    outcome: "unavailable",
  };
  const finish = (outcome: AskOutcome, fixed = false): AskOutcome => {
    audit.outcome = fixed ? "answered_fixed" : outcome.kind;
    deps.log(buildAuditLine(audit));
    return outcome;
  };

  // 1. Scope.
  const [availability, resolution] = await Promise.all([
    deps.loadAvailability(),
    deps.resolvePageContext(input.user, input.hint),
  ]);
  if (resolution.kind === "missing") return finish({ kind: "not_found" });
  const scope: AssistantScope = scopeFor(availability, resolution);
  if (!scope.docs && !scope.material) return finish({ kind: "unavailable" });

  // 2. Provider, key and model.
  const { settings } = availability;
  const { catalogue, rows, choice } = await deps.resolveProvider(
    input.user.id,
    settings.defaultModel,
  );
  if (!choice) return finish({ kind: "no_key" });
  audit.provider = choice.provider;
  audit.answerModel = choice.model;

  // The retrieval query: a follow-up is rewritten into a standalone query so
  // retrieval sees the conversation (invariant 2 of #1819).
  const retrievalHistory = recentTurns(input.history, RETRIEVAL_HISTORY_LIMITS);
  let retrievalQuery = input.question;
  if (retrievalHistory.length > 0) {
    const routerModel = resolveRouterModel({
      choice,
      catalogue,
      rows,
      routerModel: settings.routerModel,
    });
    audit.retrievalModel = routerModel;
    const rewritten = await deps.callModel({
      provider: choice.provider,
      model: routerModel,
      key: choice.key,
      messages: [{ role: "user", content: buildRewritePrompt(retrievalHistory, input.question) }],
      maxTokens: 120,
    });
    if (rewritten.kind !== "success") return finish(modelFailure(rewritten, choice));
    retrievalQuery =
      rewritten.text.split("\n")[0]?.trim() ||
      fallbackRetrievalQuery(retrievalHistory, input.question);
  }

  // 3. Documentation — fail closed, before anything is billed for the answer.
  let docs: RetrievedHelpPage[] = [];
  if (scope.docs) {
    try {
      docs = await deps.retrieveDocs({
        role: input.user.role,
        query: retrievalQuery,
        maxDocs: settings.maxDocs,
      });
    } catch (cause) {
      if (cause instanceof HelpDocsUnavailableError)
        return finish({ kind: "retrieval_unavailable" });
      throw cause;
    }
    audit.docChunks = docs.length;
  }

  // 4. Material — degrades, never throws.
  let material: MaterialContext | null = null;
  const resolved = resolution.kind === "resolved" ? resolution : null;
  if (scope.material && resolved) {
    material = await deps.buildMaterial({ resolution: resolved, query: retrievalQuery });
    audit.materialContext = material.status === "ok";
  }
  const materialBlock = material?.status === "ok" ? material : null;
  const answeredScope: AnsweredScope = {
    docs: scope.docs,
    material: scope.material && resolved ? scopeLabel(resolved) : null,
  };

  // 5. Nothing to ground in: a fixed sentence, no model call. Which one depends on why.
  if (docs.length === 0 && !materialBlock) {
    if (scope.docs) {
      return finish(
        {
          kind: "answered",
          answer: NOT_DOCUMENTED_ANSWER,
          sources: [HELP_GUIDE_SOURCE],
          scope: answeredScope,
        },
        true,
      );
    }
    const answer =
      material?.status === "failed" ? MATERIAL_UNAVAILABLE_ANSWER : MATERIAL_NOT_COVERED_ANSWER;
    return finish({ kind: "answered", answer, sources: [], scope: answeredScope }, true);
  }

  // 6. The grounded answer.
  const answer = await deps.callModel({
    provider: choice.provider,
    model: choice.model,
    key: choice.key,
    system: buildSystemPrompt({
      docs,
      material: materialBlock ? { label: materialBlock.label, block: materialBlock.block } : null,
    }),
    messages: buildAnswerMessages(input.history, input.question),
    maxTokens: 1_200,
  });
  if (answer.kind !== "success") return finish(modelFailure(answer, choice));

  const sources: AssistantSource[] = [
    ...docs.map((page) => ({ id: page.id, title: page.title, url: page.url })),
    ...(materialBlock?.sources ?? []),
  ];
  return finish({
    kind: "answered",
    answer: answer.text || NOT_DOCUMENTED_ANSWER,
    sources,
    scope: answeredScope,
  });
}
