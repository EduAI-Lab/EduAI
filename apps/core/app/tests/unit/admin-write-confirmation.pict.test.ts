/**
 * PICT adapter (#1186, census docs/PICT_CENSUS.md § S7): per generated row
 * from tests/models/admin-write-confirmation.cases.json, drives the real
 * `runConfirmedAdminWriteTool` (in-memory preview map, no DB) against
 * tests/models/admin-write-confirmation.oracle.ts.
 *
 * `Identity` covers isolation both ways: on a confirm attempt it's "does the
 * caller match who registered the preview"; on a fresh `confirmed: false`
 * call it's "does this registration share a key with whatever preview
 * already existed" — a mismatch must leave that unrelated preview alone.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  runConfirmedAdminWriteTool,
} from "~/lib/agent-tools/admin-mutations.server";
import {
  registerWritePreview,
  consumeWritePreview,
  resetWritePreviewsForTests,
} from "~/lib/agent-tools/admin-write-confirmation.server";
import adminWriteConfirmationCases from "../../../../../tests/models/admin-write-confirmation.cases.json";
import {
  adminWriteConfirmationOracle,
  type AdminWriteConfirmationRow,
} from "../../../../../tests/models/admin-write-confirmation.oracle";

const rows = adminWriteConfirmationCases as AdminWriteConfirmationRow[];

const TOOL_NAME = "pictTestWriteTool";
const PAYLOAD = { field: "value" };
// runConfirmedAdminWriteTool always binds the payload to `__tool` before
// hashing it into the preview key (so confirmed:true can't reuse a preview
// registered for a different write tool) — world-builder calls that touch
// the preview map directly must hash the same bound shape or the key never
// matches what the SUT itself would compute.
const BOUND_PAYLOAD = { __tool: TOOL_NAME, ...PAYLOAD };
const REGISTERED_TURN = "registered-turn-1";
const DIFFERENT_TURN = "confirm-turn-2";
const PROBE_TURN = "post-check-probe-turn-xyz";

const PRE_ACTOR = { id: "actor-pre", role: "ADMIN" };
const OTHER_ACTOR = { id: "actor-other", role: "ADMIN" };

afterEach(() => {
  resetWritePreviewsForTests();
});

function confirmTurnValue(row: AdminWriteConfirmationRow): string | null {
  if (row.ConfirmTurn === "null") return null;
  return row.ConfirmTurn === "same-as-registered" ? REGISTERED_TURN : DIFFERENT_TURN;
}

describe.each(rows.map((row, index) => [index, row] as const))(
  "admin-write-confirmation PICT row #%i",
  (index, row) => {
    it(
      `${row.Confirmed}/${row.PreviewState}/${row.Identity}/${row.ConfirmTurn}/${row.RunOutcome} matches oracle`,
      async () => {
        const expected = adminWriteConfirmationOracle(row);

        if (row.PreviewState !== "none") {
          const ttlMs = row.PreviewState === "expired" ? -1_000 : 60_000;
          const turnId = row.PreviewState === "active-with-turn" ? REGISTERED_TURN : null;
          registerWritePreview(PRE_ACTOR.id, TOOL_NAME, BOUND_PAYLOAD, ttlMs, turnId);
        }

        const actor = row.Identity === "match" ? PRE_ACTOR : OTHER_ACTOR;
        const turnId = confirmTurnValue(row);
        let runCallCount = 0;
        const run = () => {
          runCallCount += 1;
          return Promise.resolve(
            row.RunOutcome === "success"
              ? { writeSucceeded: true as const }
              : { error: "MUTATION_FAILED" },
          );
        };

        const result = await runConfirmedAdminWriteTool(
          TOOL_NAME,
          actor,
          row.Confirmed === "true",
          run,
          PAYLOAD,
          turnId,
        ) as { writeSucceeded?: boolean; error?: string };

        switch (expected.outcome) {
          case "registers-preview":
            expect(result.writeSucceeded).toBe(false);
            expect((result as { error?: string }).error).toBe("CONFIRMATION_REQUIRED");
            // Registration must actually take effect, overwriting any prior state
            // under this exact key regardless of what PreviewState set up.
            expect(consumeWritePreview(actor.id, TOOL_NAME, BOUND_PAYLOAD, PROBE_TURN)).toBe("ok");
            break;
          case "confirmation-required":
            expect(result.writeSucceeded).toBe(false);
            expect((result as { error?: string }).error).toBe("CONFIRMATION_REQUIRED");
            break;
          case "write-succeeded": {
            expect(result.writeSucceeded).toBe(true);
            expect(runCallCount).toBe(1);
            // One-time consumption: the same confirmed:true call replayed with the
            // exact same arguments must not find a preview to consume a second time,
            // and must not run the write again.
            const replay = await runConfirmedAdminWriteTool(
              TOOL_NAME,
              actor,
              true,
              run,
              PAYLOAD,
              turnId,
            ) as { writeSucceeded?: boolean; error?: string };
            expect(replay.writeSucceeded).toBe(false);
            expect(replay.error).toBe("CONFIRMATION_REQUIRED");
            expect(runCallCount).toBe(1);
            break;
          }
          case "write-failed":
            expect(result.writeSucceeded).toBe(false);
            expect((result as { error?: string }).error).toBeTruthy();
            break;
        }
      },
    );
  },
);

describe("admin-write-confirmation preview key isolation (tool/payload, beyond the Identity axis)", () => {
  // The preview key is (actorId, toolName, payloadHash) — the generated rows above only vary
  // actor identity via `Identity`. These cover the other two components directly, since a bug
  // that ignored toolName or payload in the lookup would still pass every generated row.
  const OTHER_TOOL_NAME = "pictTestWriteTool_other";
  const OTHER_PAYLOAD = { field: "different-value" };

  const run = () => Promise.resolve({ writeSucceeded: true as const });

  it("does not let a confirm under a different tool name consume a preview registered for this tool", async () => {
    registerWritePreview(PRE_ACTOR.id, TOOL_NAME, BOUND_PAYLOAD, 60_000, null);

    const result = (await runConfirmedAdminWriteTool(
      OTHER_TOOL_NAME,
      PRE_ACTOR,
      true,
      run,
      PAYLOAD,
      null,
    )) as { writeSucceeded?: boolean; error?: string };
    expect(result.writeSucceeded).toBe(false);
    expect(result.error).toBe("CONFIRMATION_REQUIRED");

    // The original preview must still be intact and confirmable under its real tool name.
    expect(consumeWritePreview(PRE_ACTOR.id, TOOL_NAME, BOUND_PAYLOAD, null)).toBe("ok");
  });

  it("does not let a confirm with a different payload consume a preview registered for this payload", async () => {
    registerWritePreview(PRE_ACTOR.id, TOOL_NAME, BOUND_PAYLOAD, 60_000, null);

    const result = (await runConfirmedAdminWriteTool(
      TOOL_NAME,
      PRE_ACTOR,
      true,
      run,
      OTHER_PAYLOAD,
      null,
    )) as { writeSucceeded?: boolean; error?: string };
    expect(result.writeSucceeded).toBe(false);
    expect(result.error).toBe("CONFIRMATION_REQUIRED");

    // The original preview must still be intact and confirmable under its real payload.
    expect(consumeWritePreview(PRE_ACTOR.id, TOOL_NAME, BOUND_PAYLOAD, null)).toBe("ok");
  });
});
