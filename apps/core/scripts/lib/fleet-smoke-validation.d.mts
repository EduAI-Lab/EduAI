export type FleetSmokeResult = {
  ok: boolean;
  modelIds?: string[];
};

export function missingExpectedFleetModels(
  results: FleetSmokeResult[],
  expectedModels: string[],
): string[];
