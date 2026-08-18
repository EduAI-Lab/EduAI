/**
 * PICT adapter (#1184) — parse-validate-canvas-url QM half of Core ∪ QM drift.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { validateCanvasUrl, CanvasUrlValidationError } from "../../src/utils/canvasUrlGuard.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../../..");
const rows = JSON.parse(
  readFileSync(path.join(repoRoot, "tests/models/parse-validate-canvas-url.cases.json"), "utf8"),
);

const { canvasUrlStringForRow, parseValidateCanvasUrlOracle } = await import(
  path.join(repoRoot, "tests/models/parse-validate-canvas-url.oracle.ts")
);

function runQmValidator(rawUrl) {
  try {
    validateCanvasUrl(rawUrl);
    return { accept: true };
  } catch (error) {
    if (error instanceof CanvasUrlValidationError) {
      return { accept: false };
    }
    throw error;
  }
}

describe.each(rows.map((row, index) => [index, row]))(
  "parse-validate-canvas-url PICT QM row #%i %s/%s/%s",
  (index, row) => {
    it('matches the shared oracle', () => {
      const sharedExpected = parseValidateCanvasUrlOracle(row);
      // QM still rejects credentials and query strings, while allowing an
      // HTTPS path prefix (including path-traversal segments that the URL
      // parser normalizes). ExtraPath `query-ssrf` remains rejected.
      const expected = {
        accept:
          sharedExpected.accept &&
          row.UrlShape === 'https-host' &&
          row.ExtraPath !== 'query-ssrf',
      };
      const rawUrl = canvasUrlStringForRow(row);
      const actual = runQmValidator(rawUrl);
      expect(actual.accept).toBe(expected.accept);
    });
  },
);
