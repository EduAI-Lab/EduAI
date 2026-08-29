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

/**
 * Host-aware check (#1529 review): a model missing from the union of ALL
 * healthy hosts is a real failure, but the reverse pass is a false green —
 * "present somewhere across all healthy hosts" can hide the one host that
 * actually matters being down. E.g. cmps01 + cmps03 healthy while cmps02 (the
 * only host declared to serve the retained Assist model) is down: the union
 * still contains the Qwen3.5 defaults from cmps01, so a host-blind check
 * passes even though Assist Auto has no eligible host in practice.
 *
 * `declaredHostModels` is the fleet.config.json server -> declared `models`
 * mapping (server id -> lowercased model id array). For each declared model,
 * every host declared to serve it must be BOTH healthy AND actually
 * advertising it live. A model with no declared host (not present in any
 * server's `models` list, e.g. fleet.config.json is absent/legacy env-var
 * mode) falls back to the union check, since there is no host mapping to be
 * host-aware with.
 *
 * Returns one entry per violation: `{ modelId, hostId, reason }` where reason
 * is "host-down" (declared host missing from the healthy results) or
 * "not-advertised" (declared host is healthy but its live /v1/models list
 * does not include the model).
 */
export function hostScopedMissingModels(results, expectedModels, declaredHostModels) {
  const byId = new Map(results.map((result) => [result.id, result]));
  const declaredModelToHosts = new Map();
  for (const [hostId, models] of Object.entries(declaredHostModels ?? {})) {
    for (const modelId of models ?? []) {
      const key = String(modelId).toLowerCase();
      if (!declaredModelToHosts.has(key)) declaredModelToHosts.set(key, []);
      declaredModelToHosts.get(key).push(hostId);
    }
  }

  const violations = [];
  const undeclaredExpected = [];

  for (const modelId of expectedModels) {
    const key = modelId.toLowerCase();
    const hosts = declaredModelToHosts.get(key);
    if (!hosts || hosts.length === 0) {
      // No declared owner for this model — nothing host-specific to check.
      undeclaredExpected.push(modelId);
      continue;
    }
    for (const hostId of hosts) {
      const host = byId.get(hostId);
      if (!host || !host.ok) {
        violations.push({ modelId, hostId, reason: "host-down" });
        continue;
      }
      const live = (host.modelIds ?? []).map((id) => String(id).toLowerCase());
      if (!live.includes(key)) {
        violations.push({ modelId, hostId, reason: "not-advertised" });
      }
    }
  }

  // Models with no declared host still need the old union check so a fleet
  // running without fleet.config.json (legacy env-var mode) keeps its
  // existing coverage instead of silently skipping validation.
  const unionMissing = missingExpectedFleetModels(results, undeclaredExpected);
  for (const modelId of unionMissing) {
    violations.push({ modelId, hostId: null, reason: "missing-everywhere" });
  }

  return violations;
}
