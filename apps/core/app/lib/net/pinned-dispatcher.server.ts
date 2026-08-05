import type { LookupFunction } from "node:net";
import { Agent } from "undici";

import { resolvePublicHost } from "./ssrf-guard.server";

/**
 * A `dns.lookup`-shaped function that resolves through `resolvePublicHost` and
 * hands the socket layer only an address that passed the SSRF range checks.
 *
 * This is what closes the gap a pre-flight hostname check leaves open: without
 * it the request re-resolves the name itself, so a name that answered with a
 * public address during the check can answer with a private one microseconds
 * later (DNS rebinding). Pinning means the address that was validated is the
 * address that gets connected to.
 *
 * undici calls this with `options.all === true` and expects an array; Node's
 * `net` may call it with `all` unset and expect `(err, address, family)`. Both
 * shapes are handled — returning the wrong one makes the lookup silently fail
 * to apply rather than error loudly.
 *
 * Note this never runs for a URL whose host is already an IP literal: `net`
 * only resolves names. Literals are covered by the save-time and pre-flight
 * checks instead; pinning is specifically the anti-rebinding layer, and
 * rebinding requires a name.
 */
export function createPinnedLookup(): LookupFunction {
  const lookup = (
    hostname: string,
    options: { all?: boolean } | undefined,
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | { address: string; family: number }[],
      family?: number,
    ) => void,
  ): void => {
    resolvePublicHost(hostname).then(
      ({ address, family }) => {
        if (options?.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
      (error: unknown) => {
        callback(
          error instanceof Error ? error : new Error("Host resolution failed"),
          "",
        );
      },
    );
  };

  return lookup as unknown as LookupFunction;
}

let pinnedAgent: Agent | undefined;

/**
 * Shared dispatcher for outbound requests to user-supplied hosts. Pass as the
 * `dispatcher` init option — both `undici.fetch` and Node's global `fetch`
 * honour it, as does `undici.request`.
 *
 * Lazily constructed so importing this module doesn't open a connection pool in
 * processes (tests, scripts) that never make a request.
 */
export function getPinnedDispatcher(): Agent {
  pinnedAgent ??= new Agent({ connect: { lookup: createPinnedLookup() } });
  return pinnedAgent;
}
