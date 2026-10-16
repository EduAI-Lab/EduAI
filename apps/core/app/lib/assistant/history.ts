/**
 * @file Conversation history handling for the help assistant (#1820). Pure.
 *
 * Three separate steps, deliberately not merged — each guards a different
 * failure, and merging them makes it easy to drop one:
 *
 * 1. {@link recentTurns} caps what is resent: newest N turns, then trimmed from
 *    the OLDEST survivor until it fits a character budget.
 * 2. {@link withoutLeadingAssistantTurns} — after capping, the oldest survivor can
 *    be an assistant turn, and a role-aware provider rejects a messages array that
 *    does not start with a user turn.
 * 3. {@link strictlyAlternating} — defence in depth over the whole outbound list.
 *    History arrives from the request; a stale or replayed client must never hand
 *    a provider two adjacent turns of the same role.
 */

/** Normalized roles only — never a provider's own vocabulary. */
export type AssistantRole = "user" | "assistant";

export type AssistantTurn = { role: AssistantRole; content: string };

/** Answer call: 10 turns / 8,000 chars. */
export const ANSWER_HISTORY_LIMITS = { maxTurns: 10, maxChars: 8_000 } as const;
/** Follow-up rewriting for retrieval: 6 turns / 4,000 chars. */
export const RETRIEVAL_HISTORY_LIMITS = { maxTurns: 6, maxChars: 4_000 } as const;

export function recentTurns(
  history: readonly AssistantTurn[],
  limits: { maxTurns: number; maxChars: number },
): AssistantTurn[] {
  const kept = history.slice(-Math.max(0, limits.maxTurns));
  let total = kept.reduce((sum, turn) => sum + turn.content.length, 0);
  while (kept.length > 0 && total > limits.maxChars) {
    const oldest = kept.shift();
    total -= oldest?.content.length ?? 0;
  }
  return kept;
}

export function withoutLeadingAssistantTurns(turns: readonly AssistantTurn[]): AssistantTurn[] {
  const firstUser = turns.findIndex((turn) => turn.role === "user");
  return firstUser === -1 ? [] : turns.slice(firstUser);
}

/** Drops the EARLIER of any two adjacent same-role turns, so the newest of each run wins. */
export function strictlyAlternating(turns: readonly AssistantTurn[]): AssistantTurn[] {
  const out: AssistantTurn[] = [];
  for (const turn of turns) {
    if (out.length > 0 && out[out.length - 1].role === turn.role) {
      out[out.length - 1] = turn;
    } else {
      out.push(turn);
    }
  }
  return out;
}

/**
 * The full outbound conversation for the answer call: capped history, a leading
 * assistant turn dropped, the question appended, and the whole list forced to
 * alternate. Always ends with the question as a user turn.
 */
export function buildAnswerMessages(
  history: readonly AssistantTurn[],
  question: string,
): AssistantTurn[] {
  const capped = withoutLeadingAssistantTurns(recentTurns(history, ANSWER_HISTORY_LIMITS));
  return strictlyAlternating([...capped, { role: "user", content: question }]);
}

/** History as plain text lines, for prompts where role adjacency means nothing. */
export function historyAsText(turns: readonly AssistantTurn[]): string {
  return turns
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.content}`)
    .join("\n");
}
