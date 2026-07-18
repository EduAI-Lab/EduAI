import type { RouterTier } from "@prisma/client";

export function routerTierToNum(t: RouterTier): 1 | 2 | 3 {
  if (t === "TIER_1") return 1;
  if (t === "TIER_2") return 2;
  return 3;
}

export function numToRouterTier(n: number): RouterTier | null {
  if (n === 1) return "TIER_1";
  if (n === 2) return "TIER_2";
  if (n === 3) return "TIER_3";
  return null;
}
