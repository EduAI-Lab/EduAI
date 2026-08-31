export type FleetSmokeResult = {
  id?: string;
  ok: boolean;
  modelIds?: string[];
};

export function missingExpectedFleetModels(
  results: FleetSmokeResult[],
  expectedModels: string[],
): string[];

export type FleetSmokeModelViolation = {
  modelId: string;
  hostId: string | null;
  reason: "host-down" | "not-advertised" | "missing-everywhere";
};

export function hostScopedMissingModels(
  results: FleetSmokeResult[],
  expectedModels: string[],
  declaredHostModels: Record<string, string[]>,
): FleetSmokeModelViolation[];
