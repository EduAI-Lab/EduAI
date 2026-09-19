/**
 * Display labels for the AI status panel (#764 follow-on).
 *
 * Internal fleet ids never reach the browser. The API emits "Server 01" and
 * "Qwen:9b-01"; `serverId` and the raw `modelId` stay server-side.
 *
 * The suffix comes from the host id's trailing digits, NOT from position in
 * VLLM_FLEET_CHAT_URLS. Ordinal-by-config-order would silently re-point
 * historical bars at a different machine when a URL is reordered or removed.
 *
 * The sorted-ordinal fallback is the expected production path, not an edge
 * case: the fleet config file is the preferred production source and takes
 * `id` verbatim from the author, so ids need not be hostnames or end in digits.
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Two-digit suffix for a host: trailing digits, else a stable sorted ordinal. */
export function serverSuffix(serverId: string, allIds: string[]): string {
  const digits = /(\d+)$/.exec(serverId);
  if (digits) return pad2(Number(digits[1]));

  const index = [...allIds].sort().indexOf(serverId);
  // An id absent from the live set still needs a deterministic label; "00"
  // marks it as unplaceable rather than colliding with a real ordinal.
  return index < 0 ? "00" : pad2(index + 1);
}

export function serverDisplayLabel(serverId: string, allIds: string[]): string {
  return `Server ${serverSuffix(serverId, allIds)}`;
}

export function serverKey(serverId: string, allIds: string[]): string {
  return `server-${serverSuffix(serverId, allIds)}`;
}

/** "qwen3.5-9b-instruct" -> { family: "Qwen", size: "9b" }, or null. */
function parseModel(modelId: string): { family: string; size: string } | null {
  const family = /^([a-z]+)/i.exec(modelId);
  const size = /(\d+b)\b/i.exec(modelId);
  if (!family || !size) return null;
  const word = family[1];
  return {
    family: word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    size: size[1].toLowerCase(),
  };
}

export function modelDisplayLabel(modelId: string, serverId: string, allIds: string[]): string {
  const suffix = serverSuffix(serverId, allIds);
  const parsed = parseModel(modelId);
  return parsed ? `${parsed.family}:${parsed.size}-${suffix}` : `${modelId}-${suffix}`;
}

export function modelKey(modelId: string, serverId: string, allIds: string[]): string {
  const suffix = serverSuffix(serverId, allIds);
  const parsed = parseModel(modelId);
  const stem = parsed
    ? `${parsed.family.toLowerCase()}-${parsed.size}`
    : modelId
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
  return `${stem}-${suffix}`;
}
