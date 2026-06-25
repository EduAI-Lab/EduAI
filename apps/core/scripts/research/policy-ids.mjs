/** Canonical research policy ids (P0–P3) and legacy aliases from earlier naming. */

export const POLICY_ALIASES = {
  P0: "P0",
  P1: "P1",
  P2: "P2",
  P3: "P3",
  P3A: "P2",
  P3B: "P3",
};

/** JSONL `policy` values that belong to a canonical policy id. */
export const POLICY_LEGACY_ROWS = {
  P2: ["P2", "P3a"],
  P3: ["P3", "P3b"],
};

export function normalizePolicyKey(raw) {
  const key = String(raw ?? "").trim().toUpperCase();
  return POLICY_ALIASES[key] ?? String(raw ?? "").trim();
}

export function rowMatchesPolicy(row, policy) {
  const id = normalizePolicyKey(policy);
  const legacy = POLICY_LEGACY_ROWS[id];
  if (legacy) return legacy.includes(row.policy);
  return row.policy === id;
}
