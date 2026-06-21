import { readFileSync } from "node:fs";

/**
 * Load JSONL run rows; optionally keep latest row per (prompt_id, tier).
 */
export function loadRunRows(filePath, { dedupe = true } = {}) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8").trim();
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") {
      throw new Error(`Run file not found: ${filePath}`);
    }
    throw e;
  }
  if (!raw) return [];

  const rows = raw.split("\n").map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (e) {
      throw new Error(`Line ${i + 1}: invalid JSON — ${e.message}`);
    }
  });

  if (!dedupe) return rows;

  const latest = new Map();
  for (const row of rows) {
    if (!row.prompt_id || row.tier == null) continue;
    const key = `${row.prompt_id}|${row.tier}`;
    const prev = latest.get(key);
    if (!prev || String(row.recorded_at ?? "") > String(prev.recorded_at ?? "")) {
      latest.set(key, row);
    }
  }
  return [...latest.values()];
}

export function isOkRow(row) {
  return (
    !row.error &&
    row.http_status === 200 &&
    typeof row.response === "string" &&
    row.response.length > 0
  );
}

/** @returns {Map<string, { 1?: object, 3?: object }>} */
export function pairByPrompt(rows) {
  const prompts = new Map();
  for (const row of rows) {
    if (!row.prompt_id || (row.tier !== 1 && row.tier !== 3)) continue;
    if (!prompts.has(row.prompt_id)) prompts.set(row.prompt_id, {});
    prompts.get(row.prompt_id)[row.tier] = row;
  }
  return prompts;
}

export function loadExistingLabelIds(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8").trim();
    if (!raw) return new Set();
    const ids = new Set();
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (row.prompt_id) ids.add(row.prompt_id);
    }
    return ids;
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") {
      return new Set();
    }
    throw e;
  }
}
