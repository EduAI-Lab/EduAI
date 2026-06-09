/**
 * `ROUTER_AUTO_DEFAULT` — when false / 0 / no / off, implicit Auto is disabled:
 * chat loader must not default to `auto` when no concrete `AIModel` rows exist, and `/api/chat`
 * rejects omitted `model` unless the client explicitly sends `"auto"` or a registry id.
 */
export function routerAutoDefaultEnabled(): boolean {
  const v = process.env.ROUTER_AUTO_DEFAULT;
  if (v === undefined || v === "") return true;
  const lower = v.toLowerCase();
  return lower !== "false" && lower !== "0" && lower !== "no" && lower !== "off";
}
