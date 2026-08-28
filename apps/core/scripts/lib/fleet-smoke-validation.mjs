/**
 * Return expected models that are absent from the union of healthy hosts.
 * A fleet is only usable when every configured default is advertised by at
 * least one healthy host; checking only the retained Assist model can produce
 * a false green result when the interactive Qwen 3.5 fleet is missing.
 */
export function missingExpectedFleetModels(results, expectedModels) {
  const available = new Set(
    results
      .filter((result) => result.ok)
      .flatMap((result) => result.modelIds ?? [])
      .map((modelId) => String(modelId).toLowerCase()),
  );
  return expectedModels.filter((modelId) => !available.has(modelId.toLowerCase()));
}
