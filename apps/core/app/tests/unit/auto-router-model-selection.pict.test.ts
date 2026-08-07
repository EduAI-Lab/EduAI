// PICT drift-contract adapter (#1182, census docs/PICT_CENSUS.md § S3): one committed
// row table (tests/models/auto-router-model-selection.cases.json) and one spec-derived
// oracle (tests/models/auto-router-model-selection.oracle.ts) assert observable router
// telemetry from resolveRoutedModel — mode override, image hard-rules, hybrid kNN gate,
// LLM tier-3 escalation, and classifier fail-open — without HTTP chat or a live DB.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RouterInputContext } from "~/lib/ai/routing/router";
import type { KnnTierPrediction } from "~/lib/ai/routing/knn";
import type { LlmRouteClassification } from "~/lib/ai/routing/llm-classifier";

const mockPredictTierKnn = vi.hoisted(() => vi.fn<() => Promise<KnnTierPrediction>>());
const mockClassifyPromptForTier = vi.hoisted(() =>
  vi.fn<() => Promise<LlmRouteClassification>>(),
);
const mockPickModelForSpec = vi.hoisted(() => vi.fn());

vi.mock("~/lib/ai/routing/knn", () => ({
  predictTierKnn: mockPredictTierKnn,
}));

vi.mock("~/lib/ai/routing/llm-classifier", () => ({
  classifyPromptForTier: mockClassifyPromptForTier,
  tierFromLlmClassification: (classification: LlmRouteClassification) => {
    if (classification.complexity === "low") return 1;
    if (classification.complexity === "high") return 3;
    return 2;
  },
}));

vi.mock("~/lib/ai/routing/tiers", () => ({
  pickModelForSpec: mockPickModelForSpec,
}));

import { resolveRoutedModel, type RouterMode } from "~/lib/ai/routing/router";
import autoRouterCases from "../../../../../tests/models/auto-router-model-selection.cases.json";
import {
  autoRouterOracle,
  expectedRuleId,
  expectedRouterVersion,
  resolveEffectiveMode,
  type AutoRouterRow,
} from "../../../../../tests/models/auto-router-model-selection.oracle";

const rows = autoRouterCases as AutoRouterRow[];

const TIER3_PROMPT =
  "Look up the latest UBCO academic calendar deadline for course withdrawal and summarize it.";
const NEUTRAL_PROMPT = "Explain the midterm grading rubric in detail.";

const KNN_HIGH: KnnTierPrediction = {
  tier: 2,
  confidence: 0.9,
  neighbors: [{ prompt: "neighbor", tier: 2, similarity: 0.9 }],
  exemplarCount: 1,
};

const KNN_LOW: KnnTierPrediction = {
  tier: 2,
  confidence: 0.3,
  neighbors: [{ prompt: "neighbor", tier: 2, similarity: 0.3 }],
  exemplarCount: 1,
};

const CLASSIFIER_OK: LlmRouteClassification = {
  task: "chat",
  complexity: "low",
  confidence: 90,
};

const STUB_MODEL = {
  registryId: "openai:gpt-4o-mini",
  tier: 1 as const,
  routerTier: "TIER_1" as const,
  estEnergyJoulesPerToken: null,
  averageCarbonGramsPerToken: null,
  supportsImages: false,
  supportsTools: true,
};

const ORIGINAL_ENV = {
  ROUTER_MODE: process.env.ROUTER_MODE,
  ROUTING_KNN_MIN_SIM: process.env.ROUTING_KNN_MIN_SIM,
  VLLM_BASE_URL: process.env.VLLM_BASE_URL,
};

function buildRouterInputs(row: AutoRouterRow): {
  prompt: string;
  context: RouterInputContext;
  modeOverride?: RouterMode;
} {
  const prompt = row.Tier3RuleMatch === "yes" ? TIER3_PROMPT : NEUTRAL_PROMPT;
  const context: RouterInputContext = {
    courseId: row.Tier3RuleMatch === "yes" ? null : "course-1",
    imagesPresent: row.ImagesPresent === "yes",
  };
  const modeOverride =
    row.ModeOverride === "none" ? undefined : (row.ModeOverride as RouterMode);
  return { prompt, context, modeOverride };
}

function configureMocks(row: AutoRouterRow) {
  mockPredictTierKnn.mockResolvedValue(row.KnnConfidence === "high" ? KNN_HIGH : KNN_LOW);

  if (row.ClassifierThrows === "yes") {
    mockClassifyPromptForTier.mockRejectedValue(new Error("classifier down"));
  } else {
    mockClassifyPromptForTier.mockResolvedValue(CLASSIFIER_OK);
  }

  mockPickModelForSpec.mockResolvedValue(STUB_MODEL);
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.VLLM_BASE_URL;
  process.env.ROUTING_KNN_MIN_SIM = "0.55";
  mockPickModelForSpec.mockResolvedValue(STUB_MODEL);
});

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe.each(rows.map((row, index) => ({ row, index })))(
  "auto-router-model-selection PICT row #$index $row.RouterMode/$row.ModeOverride/$row.ImagesPresent/$row.Tier3RuleMatch/$row.KnnConfidence/$row.ClassifierThrows",
  ({ row }) => {
    it("matches the oracle verdict via resolveRoutedModel", async () => {
      process.env.ROUTER_MODE = row.RouterMode;
      configureMocks(row);

      const { prompt, context, modeOverride } = buildRouterInputs(row);
      const verdict = autoRouterOracle(row);

      const decision = await resolveRoutedModel(
        prompt,
        context,
        modeOverride ? { modeOverride } : undefined,
      );

      expect(decision.features.routerMode).toBe(verdict.effectiveMode);
      expect(decision.features.pickSource).toBe(verdict.pickSource);
      expect(decision.features.routerVersion).toBe(
        expectedRouterVersion(verdict.effectiveMode),
      );

      if (verdict.downgradedFromThrow) {
        expect(decision.features.rule).toBe("llm_classifier_fallback_rules");
        expect(decision.features.classifierError).toBe("classifier down");
      } else if (verdict.pickSource === "knn" || verdict.pickSource === "llm") {
        expect(decision.features.rule).toBe(expectedRuleId(row));
      }

      const effectiveMode = resolveEffectiveMode(row);
      const usesKnn = effectiveMode === "knn" || effectiveMode === "hybrid";
      const usesClassifier =
        effectiveMode === "llm" &&
        row.ImagesPresent === "no" &&
        row.Tier3RuleMatch === "no";

      if (usesKnn && row.ImagesPresent === "no") {
        expect(mockPredictTierKnn).toHaveBeenCalledWith(prompt);
      } else {
        expect(mockPredictTierKnn).not.toHaveBeenCalled();
      }

      if (usesClassifier) {
        expect(mockClassifyPromptForTier).toHaveBeenCalledWith(prompt, context);
      } else {
        expect(mockClassifyPromptForTier).not.toHaveBeenCalled();
      }
    });
  },
);
