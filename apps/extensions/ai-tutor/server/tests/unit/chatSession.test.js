/**
 * #1646: student chat history was always empty because a chatId was never
 * established. Core's `/api/completion` is stateless and returns none, and the
 * client only adopts a server-supplied chatId, so `upsertChatSession`
 * early-returned on `!chatId` and no `AiChatSession` row was ever written.
 * `resolveNextChatId` makes AI Tutor own its session identity: it always yields
 * a non-null chatId so a row is persisted and the history panel is non-empty.
 */
import { describe, it, expect } from "vitest";
import { resolveNextChatId } from "../../src/utils/chatSession.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("resolveNextChatId (#1646)", () => {
  it("prefers an upstream-minted chatId when present", () => {
    expect(resolveNextChatId("upstream-id", "client-id")).toBe("upstream-id");
  });

  it("falls back to the client-threaded chatId of an ongoing session", () => {
    expect(resolveNextChatId(null, "client-id")).toBe("client-id");
    expect(resolveNextChatId(undefined, "client-id")).toBe("client-id");
  });

  it("mints a UUID for a brand-new session when neither side supplies one", () => {
    const minted = resolveNextChatId(null, null);
    expect(minted).toMatch(UUID_RE);
  });

  it("never returns null/empty, so every turn produces a persistable session key", () => {
    for (const [ai, req] of [
      [null, null],
      [undefined, undefined],
      ["", ""],
    ]) {
      const result = resolveNextChatId(ai, req);
      expect(result).toBeTruthy();
      expect(result).toMatch(UUID_RE);
    }
  });

  it("mints a distinct chatId per new session", () => {
    expect(resolveNextChatId(null, null)).not.toBe(resolveNextChatId(null, null));
  });
});
