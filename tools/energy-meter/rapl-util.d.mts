export interface RaplZoneReading {
  zone: string;
  uj: number;
  maxUj: number | null;
}

export interface PowerSample {
  t?: number;
  mw: number;
}

/**
 * Compute joules from paired start/end package readings, handling counter wrap.
 * Returns null if there are no paired zones.
 */
export function raplDeltaJoules(
  startZones: RaplZoneReading[],
  endZones: RaplZoneReading[],
): number | null;

/**
 * Trapezoidal integral using sample timestamps (ms). Falls back to fixedDtSec when
 * timestamps are missing or non-monotonic.
 */
export function integratePowerSamplesMw(
  samples: PowerSample[],
  fixedDtSec: number,
): number | null;
