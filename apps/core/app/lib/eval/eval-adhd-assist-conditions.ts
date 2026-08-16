export type EvalCondition =
  | "baseline"
  | "assist-prompt-only"
  | "assist-oversight"
  | "assist-deterministic";

export type EvalConditionConfig = {
  adhdAssist: boolean;
  label: string;
  dirName: string;
  requiresOversight: boolean | null;
  /**
   * Research ablation only (#1226): server must also have
   * ADHD_ASSIST_OVERSIGHT_DETERMINISTIC_ONLY=true for this condition —
   * see isAdhdOversightDeterministicOnly() in adhd-oversight.ts.
   */
  requiresDeterministicOnly?: boolean;
};

export const CONDITIONS: Record<EvalCondition, EvalConditionConfig> = {
  baseline: {
    adhdAssist: false,
    label: "Baseline",
    dirName: "baseline",
    requiresOversight: null,
  },
  "assist-prompt-only": {
    adhdAssist: true,
    label: "ADHD Assist (prompt only)",
    dirName: "assist-prompt-only",
    requiresOversight: false,
  },
  "assist-oversight": {
    adhdAssist: true,
    label: "ADHD Assist + oversight",
    dirName: "assist-oversight",
    requiresOversight: true,
  },
  "assist-deterministic": {
    adhdAssist: true,
    label: "ADHD Assist + deterministic-only oversight (ablation)",
    dirName: "assist-deterministic",
    requiresOversight: true,
    requiresDeterministicOnly: true,
  },
};

/** The three conditions "all-three" resolves to (Form A RQ3) — does not
 * include assist-deterministic, which is a separate ablation selected
 * explicitly via --mode assist-deterministic, not bundled into this mode. */
export const ALL_CONDITIONS: EvalCondition[] = [
  "baseline",
  "assist-prompt-only",
  "assist-oversight",
];

/** @deprecated CLI aliases — prefer explicit condition names. */
export const LEGACY_MODE_ALIASES: Record<string, EvalCondition> = {
  off: "baseline",
  on: "assist-oversight",
};

export class EvalAdhdAssistModeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalAdhdAssistModeError";
  }
}

export type ResolveConditionsOptions = {
  onWarn?: (message: string) => void;
};

/**
 * Maps `--mode` CLI values to the eval arms to run (Form A RQ3).
 */
export function resolveConditions(
  rawMode: string,
  options: ResolveConditionsOptions = {},
): EvalCondition[] {
  const warn = options.onWarn ?? (() => {});

  if (rawMode === "all-three") {
    return [...ALL_CONDITIONS];
  }
  if (rawMode === "both") {
    warn(
      "warning: --mode both is deprecated; using baseline + assist-oversight. " +
        "For Form A RQ3 use three separate runs (see script header).",
    );
    return ["baseline", "assist-oversight"];
  }

  const mapped = LEGACY_MODE_ALIASES[rawMode] ?? rawMode;
  if (!(mapped in CONDITIONS)) {
    throw new EvalAdhdAssistModeError(
      `--mode must be baseline|assist-prompt-only|assist-oversight|assist-deterministic|all-three ` +
        `(legacy: off|on|both), got "${rawMode}"`,
    );
  }

  const condition = mapped as EvalCondition;
  if (mapped !== rawMode && LEGACY_MODE_ALIASES[rawMode]) {
    warn(`warning: --mode ${rawMode} is deprecated; using ${mapped}.`);
  }
  return [condition];
}
