/**
 * Pure RAPL helpers (wrap-aware package deltas). Used by server.mjs and unit tests.
 */

/**
 * Compute joules from paired start/end package readings, handling counter wrap.
 * @param {{ zone: string, uj: number, maxUj: number|null }[]} startZones
 * @param {{ zone: string, uj: number, maxUj: number|null }[]} endZones
 * @returns {number|null} joules, or null if no paired zones
 */
export function raplDeltaJoules(startZones, endZones) {
  if (!startZones?.length || !endZones?.length) return null;
  const endByZone = new Map(endZones.map((z) => [z.zone, z]));
  let totalUj = 0;
  let paired = 0;
  for (const start of startZones) {
    const end = endByZone.get(start.zone);
    if (!end) continue;
    let delta = end.uj - start.uj;
    if (delta < 0) {
      const range = start.maxUj ?? end.maxUj;
      if (range != null && range > 0) {
        delta += range;
      } else {
        delta = 0;
      }
    }
    totalUj += delta;
    paired += 1;
  }
  return paired > 0 ? totalUj / 1_000_000 : null;
}

/**
 * Trapezoidal integral using sample timestamps (ms). Falls back to fixedDtSec when
 * timestamps are missing or non-monotonic.
 * @param {{ t?: number, mw: number }[]} samples
 * @param {number} fixedDtSec
 * @returns {number|null}
 */
export function integratePowerSamplesMw(samples, fixedDtSec) {
  if (!samples?.length) return null;
  if (samples.length === 1) {
    return (samples[0].mw / 1000) * fixedDtSec;
  }
  let joules = 0;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    const avgW = (prev.mw + cur.mw) / 2 / 1000;
    const hasTs =
      Number.isFinite(prev.t) &&
      Number.isFinite(cur.t) &&
      cur.t > prev.t;
    const dt = hasTs ? (cur.t - prev.t) / 1000 : fixedDtSec;
    joules += avgW * dt;
  }
  return joules;
}
