// @vitest-environment node
//
// PICT adapter (#1184, census docs/PICT_CENSUS.md § S5): parse-validate-canvas-url
// Core half of the Core ∪ QM drift contract — asserts parseAndValidateCanvasUrl
// against the shared oracle + committed cases.

import { describe, expect, it } from "vitest";
import {
  CanvasVerificationError,
  parseAndValidateCanvasUrl,
} from "~/lib/canvas/client.server";
import parseValidateCases from "../../../../../tests/models/parse-validate-canvas-url.cases.json";
import {
  canvasUrlStringForRow,
  coreKnownDivergence,
  parseValidateCanvasUrlOracle,
  type ParseValidateCanvasUrlRow,
} from "../../../../../tests/models/parse-validate-canvas-url.oracle";

const rows = parseValidateCases as ParseValidateCanvasUrlRow[];

function runCoreValidator(rawUrl: string): { accept: boolean } {
  try {
    parseAndValidateCanvasUrl(rawUrl);
    return { accept: true };
  } catch (error) {
    if (error instanceof CanvasVerificationError) {
      return { accept: false };
    }
    throw error;
  }
}

describe.each(rows.map((row, index) => ({ row, index })))(
  "parse-validate-canvas-url PICT Core row #$index $row.UrlShape/$row.HostClass/$row.ExtraPath",
  ({ row }) => {
    const expected = parseValidateCanvasUrlOracle(row);
    const rawUrl = canvasUrlStringForRow(row);
    const testFn = coreKnownDivergence(row) ? it.fails : it;

    testFn("matches the shared oracle", () => {
      const actual = runCoreValidator(rawUrl);
      expect(actual.accept).toBe(expected.accept);
    });
  },
);
