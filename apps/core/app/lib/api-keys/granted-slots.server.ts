/**
 * A process-local cap on how many requests from granted (non-admin) API keys
 * may run at once (#2039). They share the AI admission gate with course chat,
 * and without this a few research scripts could take every slot and leave
 * students waiting. A request over the cap is refused at once, not queued.
 *
 * Env:
 *   API_ACCESS_MAX_INFLIGHT  concurrent granted-key requests (default 2; 0 = none allowed)
 */
import { parseEnvInt } from "~/lib/auth/rate-limit.server";

let inflight = 0;

export function grantedKeyMaxInflight(): number {
  return Math.max(0, Math.floor(parseEnvInt(process.env.API_ACCESS_MAX_INFLIGHT, 2)));
}

/** A release function if a slot is free, otherwise null. The release is idempotent. */
export function tryAcquireGrantedKeySlot(): (() => void) | null {
  if (inflight >= grantedKeyMaxInflight()) return null;
  inflight += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inflight -= 1;
  };
}

export function getGrantedKeyInflight(): number {
  return inflight;
}

/** Tests only. */
export function resetGrantedKeySlots(): void {
  inflight = 0;
}
