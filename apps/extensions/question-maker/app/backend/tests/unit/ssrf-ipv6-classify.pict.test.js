/**
 * PICT adapter (#1184) — ssrf-ipv6-classify against QM isPrivateIPv6.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isPrivateIPv6 } from "../../src/utils/canvasUrlGuard.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../..");
const rows = JSON.parse(
  readFileSync(path.join(repoRoot, "tests/models/ssrf-ipv6-classify.cases.json"), "utf8"),
);

const {
  normalizeIpv6ClassifierInput,
  ssrfIpv6BoundaryPublicAddress,
  ssrfIpv6BoundaryPublicVerdict,
  ssrfIpv6ClassifyOracle,
} = await import(path.join(repoRoot, "tests/models/ssrf-ipv6-classify.oracle.ts"));

describe.each(rows.map((row, index) => [index, row]))(
  "ssrf-ipv6-classify PICT row #%i %s/%s/%s/%s",
  (index, row) => {
    it("matches the oracle blocked verdict", () => {
      const sharedExpected = ssrfIpv6ClassifyOracle(row);
      // The shared oracle predates the globally-routable-only requirement and
      // labels 2001:db8::/32 (documentation space) as global. QM must block it.
      const expected = {
        ...sharedExpected,
        blocked: sharedExpected.blocked || row.AddressForm === "global",
      };
      const input = normalizeIpv6ClassifierInput(row);
      const blocked = isPrivateIPv6(input);
      expect(blocked).toBe(expected.blocked);
    });
  },
);

describe("ssrf-ipv6-classify PICT adapter — boundary complement", () => {
  it("blocks fe7f::1 because it is outside globally routable unicast space", () => {
    const sharedExpected = ssrfIpv6BoundaryPublicVerdict();
    const expected = { ...sharedExpected, blocked: true };
    const blocked = isPrivateIPv6(ssrfIpv6BoundaryPublicAddress());
    expect(blocked).toBe(expected.blocked);
  });
});
