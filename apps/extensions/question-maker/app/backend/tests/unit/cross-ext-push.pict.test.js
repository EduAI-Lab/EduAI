/**
 * PICT adapter (#1189, census § S10): cross-ext-push — QM pushQuestionToCore
 * + draft skip. Core HTTP outcomes are mocked here for the QM client path;
 * the real POST /api/questions contract (incl. P2002 adopt) is covered by the
 * Core adapter `apps/core/app/tests/unit/cross-ext-push.pict.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

vi.mock('../../src/config/settings.js', () => ({
  config: {
    coreUrl: 'http://core.test/api',
    eduaiApiKey: 'test-key',
  },
}));

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..');
const rows = JSON.parse(
  readFileSync(path.join(repoRoot, 'tests/models/cross-ext-push.cases.json'), 'utf8'),
);

const { crossExtPushOracle } = await import(
  path.join(repoRoot, 'tests/models/cross-ext-push.oracle.ts')
);

const { pushQuestionToCore } = await import('../../src/services/coreApiService.js');
const { shouldPushApprovedVariantToCore } = await import(
  '../../src/services/variant-push-gate.js'
);

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn());
});

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/**
 * Production draft/approve gate from routes/variants.js via shared helper:
 * push only when the variant is approved and not yet linked to Core.
 * PICT Draft=yes → still draft; Draft=no → approved, unlinked.
 */
function shouldPush(row) {
  return shouldPushApprovedVariantToCore({
    isDraft: row.Draft === 'yes',
    coreQuestionId: null,
  });
}

async function runPush(row) {
  if (!shouldPush(row)) {
    return { outcome: 'skip-draft' };
  }

  if (row.Session === 'missing') {
    // Empty cookie → Core 401
    vi.mocked(fetch).mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));
  } else if (row.CoreReachable === 'down-5xx') {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(503, { error: 'unavailable' }));
  } else if (row.CourseAccess === 'course-missing') {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(404, { error: 'COURSE_NOT_FOUND' }));
  } else if (row.CourseAccess === 'forbidden') {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(403, { error: 'Forbidden' }));
  } else if (row.Idempotency === 'in-progress') {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(409, { error: 'IDEMPOTENCY_IN_PROGRESS' }),
    );
  } else if (row.Idempotency === 'adopt-p2002') {
    // Adopt/replay returns the prior 201 body
    vi.mocked(fetch).mockResolvedValue(jsonResponse(201, { id: 'q-adopted' }));
  } else {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(201, { id: 'q-new' }));
  }

  const cookie = row.Session === 'present' ? 'session=abc' : '';
  try {
    const body = await pushQuestionToCore(
      { courseId: 'c1', text: 'Q?', idempotencyKey: 'k1' },
      cookie,
    );
    if (row.Idempotency === 'adopt-p2002') {
      return { outcome: 'adopt', id: body.id };
    }
    return { outcome: 'accept-201', id: body.id };
  } catch (err) {
    if (err.status === 401) return { outcome: 'unauthorized-401' };
    if (err.status === 403) return { outcome: 'forbidden-403' };
    if (err.status === 404) return { outcome: 'not-found-404' };
    if (err.status === 409) return { outcome: 'conflict-409' };
    if (err.status === 503) return { outcome: 'unavailable-503' };
    throw err;
  }
}

describe.each(rows.map((row, index) => [index, row]))(
  'cross-ext-push PICT QM row #%i',
  (index, row) => {
    it('matches the shared oracle', async () => {
      const expected = crossExtPushOracle(row);
      const actual = await runPush(row);
      expect(actual.outcome).toBe(expected.outcome);

      if (row.Draft === 'yes') {
        expect(fetch).not.toHaveBeenCalled();
      } else {
        expect(fetch).toHaveBeenCalled();
        const [, init] = vi.mocked(fetch).mock.calls[0];
        // Cookie-only — never a Bearer service key on push
        expect(init.headers.Authorization).toBeUndefined();
        expect(init.headers).toHaveProperty('cookie');
      }
    });
  },
);
