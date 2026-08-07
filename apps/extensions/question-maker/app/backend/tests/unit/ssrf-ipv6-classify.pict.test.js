/**
 * PICT adapter (#1184) — ssrf-ipv6-classify against QM isPrivateIPv6.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isPrivateIPv6 } from '../../src/utils/canvasUrlGuard.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..');
const rows = JSON.parse(
  readFileSync(path.join(repoRoot, 'tests/models/ssrf-ipv6-classify.cases.json'), 'utf8'),
);

const {
  normalizeIpv6ClassifierInput,
  ssrfIpv6BoundaryPublicAddress,
  ssrfIpv6BoundaryPublicVerdict,
  ssrfIpv6ClassifyOracle,
} = await import(path.join(repoRoot, 'tests/models/ssrf-ipv6-classify.oracle.ts'));

describe.each(rows.map((row, index) => [index, row]))(
  'ssrf-ipv6-classify PICT row #%i %s/%s/%s/%s',
  (index, row) => {
    it('matches the oracle blocked verdict', () => {
      const expected = ssrfIpv6ClassifyOracle(row);
      const input = normalizeIpv6ClassifierInput(row);
      const blocked = isPrivateIPv6(input);
      expect(blocked).toBe(expected.blocked);
    });
  },
);

describe('ssrf-ipv6-classify PICT adapter — boundary complement', () => {
  it('does not block fe7f::1 (public neighbor below link-local /10)', () => {
    const expected = ssrfIpv6BoundaryPublicVerdict();
    const blocked = isPrivateIPv6(ssrfIpv6BoundaryPublicAddress());
    expect(blocked).toBe(expected.blocked);
  });
});
