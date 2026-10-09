// @vitest-environment node
/**
 * #1820: the three history steps — capping (newest turns, trimmed from the
 * oldest), dropping a leading assistant turn, and forcing strict alternation —
 * plus the context caps with their explicit truncation marker.
 */
import { describe, expect, it } from "vitest";

import {
  ANSWER_HISTORY_LIMITS,
  buildAnswerMessages,
  recentTurns,
  strictlyAlternating,
  withoutLeadingAssistantTurns,
  type AssistantTurn,
} from "~/lib/assistant/history";
import { TRUNCATION_MARKER, capContents, truncateWithMarker } from "~/lib/assistant/context-caps";

const user = (content: string): AssistantTurn => ({ role: "user", content });
const assistant = (content: string): AssistantTurn => ({ role: "assistant", content });

describe("recentTurns", () => {
  it("keeps only the newest N turns", () => {
    const history = Array.from({ length: 14 }, (_, i) =>
      i % 2 ? assistant(`a${i}`) : user(`u${i}`),
    );
    const kept = recentTurns(history, ANSWER_HISTORY_LIMITS);
    expect(kept).toHaveLength(10);
    expect(kept.at(-1)?.content).toBe("a13");
  });

  it("trims from the OLDEST survivor until the char budget fits, never the newest", () => {
    const history = [user("x".repeat(50)), assistant("y".repeat(50)), user("z".repeat(50))];
    const kept = recentTurns(history, { maxTurns: 10, maxChars: 110 });
    expect(kept.map((t) => t.content[0])).toEqual(["y", "z"]);
  });

  it("returns nothing when even the newest turn exceeds the budget", () => {
    expect(recentTurns([user("x".repeat(20))], { maxTurns: 5, maxChars: 10 })).toEqual([]);
  });
});

describe("withoutLeadingAssistantTurns", () => {
  it("drops assistant turns before the first user turn", () => {
    expect(
      withoutLeadingAssistantTurns([assistant("a"), assistant("b"), user("c"), assistant("d")]),
    ).toEqual([user("c"), assistant("d")]);
  });

  it("returns nothing for an assistant-only history", () => {
    expect(withoutLeadingAssistantTurns([assistant("a")])).toEqual([]);
  });
});

describe("strictlyAlternating", () => {
  it("keeps the later of two adjacent same-role turns", () => {
    expect(strictlyAlternating([user("old"), user("new"), assistant("a")])).toEqual([
      user("new"),
      assistant("a"),
    ]);
  });
});

describe("buildAnswerMessages", () => {
  it("a forged history with two adjacent user turns never reaches the provider that way", () => {
    const forged = [user("first"), user("second"), assistant("reply"), user("stale, unanswered")];
    const messages = buildAnswerMessages(forged, "the real question");
    for (let i = 1; i < messages.length; i++) {
      expect(messages[i].role).not.toBe(messages[i - 1].role);
    }
    expect(messages[0].role).toBe("user");
    expect(messages.at(-1)).toEqual(user("the real question"));
    expect(messages.map((m) => m.content)).not.toContain("stale, unanswered");
  });

  it("starts with a user turn even when capping leaves an assistant turn first", () => {
    const history = [user("q1"), assistant("a1"), user("q2"), assistant("a2")];
    const capped = buildAnswerMessages(history.slice(1), "q3");
    expect(capped[0].role).toBe("user");
  });
});

describe("context caps", () => {
  it("marks a cut page explicitly instead of presenting it as complete", () => {
    const result = truncateWithMarker("a".repeat(100), 40);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(40);
    expect(result.text.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it("enforces the total cap ACROSS pages, not just per page", () => {
    const pages = [
      { id: "a", content: "a".repeat(30) },
      { id: "b", content: "b".repeat(30) },
      { id: "c", content: "c".repeat(30) },
    ];
    const capped = capContents(pages, { perItem: 30, total: 50 });
    const total = capped.reduce((sum, page) => sum + page.content.length, 0);
    expect(total).toBeLessThanOrEqual(50);
    expect(capped[0]).toMatchObject({ id: "a", truncated: false });
    expect(capped[1].truncated).toBe(true);
    expect(capped[1].content.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(capped.find((page) => page.id === "c")).toBeUndefined();
  });
});
