/**
 * Oracle for tests/models/admin-write-confirmation.pict (census docs/PICT_CENSUS.md § S7,
 * #1186).
 *
 * Derived from `runConfirmedAdminWriteTool`'s documented contract
 * (lib/agent-tools/admin-mutations.server.ts:188) and the preview map's own
 * contract (admin-write-confirmation.server.ts), not from copying either's
 * branches:
 *   - `confirmed: false` always registers a fresh, payload-bound preview and
 *     reports CONFIRMATION_REQUIRED — regardless of whatever preview existed
 *     under that key before.
 *   - `confirmed: true` looks up a preview under the exact (actorId,
 *     toolName, payloadHash) key. No matching preview, or an expired one, or
 *     one registered by a different actor/tool/payload, is indistinguishable
 *     from "never registered": CONFIRMATION_REQUIRED / "missing".
 *   - A preview registered WITHOUT a turn id confirms on any turn. One
 *     registered WITH a turn id refuses confirmation on that same turn (or
 *     with no turn id supplied) — the anti-replay guard — and only succeeds
 *     on a later, different turn.
 *   - Only a successful consumption ever runs the underlying write; its own
 *     outcome (not this gate) decides success vs failure from there.
 */

export type AdminWriteConfirmationRow = {
  Confirmed: "false" | "true";
  PreviewState: "none" | "expired" | "active-no-turn" | "active-with-turn";
  Identity: "match" | "mismatch";
  ConfirmTurn: "null" | "same-as-registered" | "different";
  RunOutcome: "success" | "failure";
};

export type Verdict =
  | { outcome: "registers-preview" }
  | { outcome: "confirmation-required"; reason: "missing" | "same_turn" }
  | { outcome: "write-succeeded" }
  | { outcome: "write-failed" };

function consumeOutcome(row: AdminWriteConfirmationRow): "missing" | "same_turn" | "ok" {
  if (row.PreviewState === "none" || row.PreviewState === "expired") return "missing";
  if (row.Identity === "mismatch") return "missing";
  if (row.PreviewState === "active-with-turn") {
    return row.ConfirmTurn === "different" ? "ok" : "same_turn";
  }
  // active-no-turn: no turn id was bound at registration, so the guard never triggers.
  return "ok";
}

export function adminWriteConfirmationOracle(row: AdminWriteConfirmationRow): Verdict {
  if (row.Confirmed === "false") return { outcome: "registers-preview" };

  const consumed = consumeOutcome(row);
  if (consumed !== "ok") return { outcome: "confirmation-required", reason: consumed };

  return row.RunOutcome === "success" ? { outcome: "write-succeeded" } : { outcome: "write-failed" };
}
