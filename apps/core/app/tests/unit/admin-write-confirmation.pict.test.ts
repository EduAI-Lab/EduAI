/**
 * Compatibility adapter for the existing generated confirmation cases.
 * The generated model still varies the legacy `confirmed` protocol flag. This
 * adapter adds the server-issued code, chat, and trusted raw-user dimensions.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  runConfirmedAdminWriteTool,
  type MutationResult,
} from "~/lib/agent-tools/admin-mutations.server";
import {
  consumeWritePreview,
  registerWritePreview,
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
const BOUND_PAYLOAD = { __tool: TOOL_NAME, ...PAYLOAD };
const CHAT_ID = "chat-1";
const REGISTERED_TURN = "registered-turn-1";
const DIFFERENT_TURN = "confirm-turn-2";
const PRE_ACTOR = { id: "actor-pre", role: "ADMIN" };
const OTHER_ACTOR = { id: "actor-other", role: "ADMIN" };
const confirmationResultSchema = z.object({ confirmationCode: z.string() });

afterEach(resetWritePreviewsForTests);

function confirmTurnValue(row: AdminWriteConfirmationRow): string {
  if (row.PreviewState === "active-no-turn") return DIFFERENT_TURN;
  return row.ConfirmTurn === "different" ? DIFFERENT_TURN : REGISTERED_TURN;
}

function codeFrom(result: MutationResult): string {
  return confirmationResultSchema.parse(result).confirmationCode;
}

describe.each(rows.map((row, index) => [index, row] as const))(
  "admin-write-confirmation PICT row #%i",
  (_index, row) => {
    it(`${row.Confirmed}/${row.PreviewState}/${row.Identity}/${row.ConfirmTurn}/${row.RunOutcome} matches oracle`, async () => {
      const expected = adminWriteConfirmationOracle(row);
      const seededPreview =
        row.PreviewState === "none"
          ? null
          : registerWritePreview({
              actorId: PRE_ACTOR.id,
              chatId: CHAT_ID,
              toolName: TOOL_NAME,
              payload: BOUND_PAYLOAD,
              ttlMs: row.PreviewState === "expired" ? -1_000 : 60_000,
              turnId: REGISTERED_TURN,
            });
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

      const result = await runConfirmedAdminWriteTool({
        toolName: TOOL_NAME,
        actor,
        confirmed: row.Confirmed === "true",
        run,
        payload: PAYLOAD,
        confirmation: {
          chatId: CHAT_ID,
          turnId,
          latestUserMessage: seededPreview?.confirmationCode ?? null,
        },
      });

      switch (expected.outcome) {
        case "registers-preview": {
          expect(result).toMatchObject({
            writeSucceeded: false,
            error: "CONFIRMATION_REQUIRED",
          });
          const code = codeFrom(result);
          expect(
            consumeWritePreview({
              actorId: actor.id,
              chatId: CHAT_ID,
              toolName: TOOL_NAME,
              payload: BOUND_PAYLOAD,
              turnId: "probe-turn",
              latestUserMessage: code,
            }),
          ).toEqual({ kind: "ok" });
          break;
        }
        case "confirmation-required":
          expect(result).toMatchObject({
            writeSucceeded: false,
            error: "CONFIRMATION_REQUIRED",
          });
          break;
        case "write-succeeded": {
          expect(result).toMatchObject({ writeSucceeded: true });
          expect(runCallCount).toBe(1);
          const replay = await runConfirmedAdminWriteTool({
            toolName: TOOL_NAME,
            actor,
            confirmed: true,
            run,
            payload: PAYLOAD,
            confirmation: {
              chatId: CHAT_ID,
              turnId: "replay-turn",
              latestUserMessage: seededPreview?.confirmationCode ?? null,
            },
          });
          expect(replay).toMatchObject({
            writeSucceeded: false,
            error: "CONFIRMATION_REQUIRED",
          });
          expect(runCallCount).toBe(1);
          break;
        }
        case "write-failed":
          expect(result).toMatchObject({ writeSucceeded: false });
          expect(runCallCount).toBe(1);
          break;
      }
    });
  },
);

describe("admin-write-confirmation preview isolation", () => {
  const run = () => Promise.resolve({ writeSucceeded: true as const });

  it.each([
    ["tool", "otherTool", PAYLOAD],
    ["payload", TOOL_NAME, { field: "different-value" }],
  ])("does not reuse a code for a different %s", async (_dimension, toolName, payload) => {
    const preview = registerWritePreview({
      actorId: PRE_ACTOR.id,
      chatId: CHAT_ID,
      toolName: TOOL_NAME,
      payload: BOUND_PAYLOAD,
      turnId: REGISTERED_TURN,
    });

    const result = await runConfirmedAdminWriteTool({
      toolName,
      actor: PRE_ACTOR,
      confirmed: true,
      run,
      payload,
      confirmation: {
        chatId: CHAT_ID,
        turnId: DIFFERENT_TURN,
        latestUserMessage: preview.confirmationCode,
      },
    });
    expect(result).toMatchObject({ writeSucceeded: false, error: "CONFIRMATION_REQUIRED" });
    expect(
      consumeWritePreview({
        actorId: PRE_ACTOR.id,
        chatId: CHAT_ID,
        toolName: TOOL_NAME,
        payload: BOUND_PAYLOAD,
        turnId: DIFFERENT_TURN,
        latestUserMessage: preview.confirmationCode,
      }),
    ).toEqual({ kind: "ok" });
  });
});
