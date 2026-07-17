import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  capTokensForLongOutputIntent,
  resolveLongOutputMaxTokens,
} from "~/lib/ai/long-output-cap";
import { isLongOutputIntent } from "~/lib/ai/long-output-intent";

describe("isLongOutputIntent", () => {
  it.each([
    "Summarise this whole chat",
    "Summarize the entire conversation",
    "Please recap this whole conversation",
    "Explain everything we covered",
    "Give me a complete chat summary",
    "Tell me everything we discussed",
  ])("detects long-output prompt: %s", (prompt) => {
    expect(isLongOutputIntent(prompt)).toBe(true);
  });

  it.each([
    "Summarise this paragraph",
    "Summarise the previous answer",
    "Explain OAuth",
    "What did we just discuss?",
    "Give me a short answer",
    "",
    "   ",
  ])("does not detect normal prompt: %s", (prompt) => {
    expect(isLongOutputIntent(prompt)).toBe(false);
  });
});

describe("resolveLongOutputMaxTokens", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the default normal cap", () => {
    expect(resolveLongOutputMaxTokens(false)).toBe(1200);
  });

  it("uses the tighter default ADHD cap", () => {
    expect(resolveLongOutputMaxTokens(true)).toBe(600);
  });

  it("uses the normal environment override", () => {
    vi.stubEnv(
      "CHAT_LONG_OUTPUT_MAX_TOKENS",
      "1500",
    );

    expect(resolveLongOutputMaxTokens(false)).toBe(1500);
  });

  it("uses the ADHD environment override", () => {
    vi.stubEnv(
      "CHAT_LONG_OUTPUT_ADHD_MAX_TOKENS",
      "700",
    );

    expect(resolveLongOutputMaxTokens(true)).toBe(700);
  });

  it.each([
    "",
    "0",
    "-1",
    "not-a-number",
    "600junk",
    "1.5",
  ])(
    "falls back when the normal env value is invalid: %s",
    (value) => {
      vi.stubEnv(
        "CHAT_LONG_OUTPUT_MAX_TOKENS",
        value,
      );

      expect(resolveLongOutputMaxTokens(false)).toBe(1200);
    },
  );

  it.each([
    "",
    "0",
    "-1",
    "not-a-number",
    "600junk",
    "1.5",
  ])(
    "falls back when the ADHD env value is invalid: %s",
    (value) => {
      vi.stubEnv(
        "CHAT_LONG_OUTPUT_ADHD_MAX_TOKENS",
        value,
      );

      expect(resolveLongOutputMaxTokens(true)).toBe(600);
    },
  );
});

describe("capTokensForLongOutputIntent", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("caps a whole-chat summary using the normal cap", () => {
    const result = capTokensForLongOutputIntent({
      prompt: "Summarise this whole chat",
      currentMaxTokens: 8192,
      adhdAssist: false,
    });

    expect(result).toEqual({
      maxTokens: 1200,
      isLongOutputIntent: true,
    });
  });

  it("uses the tighter cap with ADHD Assist enabled", () => {
    const result = capTokensForLongOutputIntent({
      prompt: "Summarise this whole chat",
      currentMaxTokens: 8192,
      adhdAssist: true,
    });

    expect(result).toEqual({
      maxTokens: 600,
      isLongOutputIntent: true,
    });
  });

  it("leaves a normal prompt unchanged", () => {
    const result = capTokensForLongOutputIntent({
      prompt: "Explain dependency injection",
      currentMaxTokens: 8192,
      adhdAssist: false,
    });

    expect(result).toEqual({
      maxTokens: 8192,
      isLongOutputIntent: false,
    });
  });

  it("never raises an existing lower cap", () => {
    const result = capTokensForLongOutputIntent({
      prompt: "Summarise this whole chat",
      currentMaxTokens: 300,
      adhdAssist: false,
    });

    expect(result).toEqual({
      maxTokens: 300,
      isLongOutputIntent: true,
    });
  });

  it("respects the normal environment override", () => {
    vi.stubEnv(
      "CHAT_LONG_OUTPUT_MAX_TOKENS",
      "900",
    );

    const result = capTokensForLongOutputIntent({
      prompt: "Recap the entire conversation",
      currentMaxTokens: 8192,
      adhdAssist: false,
    });

    expect(result.maxTokens).toBe(900);
    expect(result.isLongOutputIntent).toBe(true);
  });

  it("respects the ADHD environment override", () => {
    vi.stubEnv(
      "CHAT_LONG_OUTPUT_ADHD_MAX_TOKENS",
      "450",
    );

    const result = capTokensForLongOutputIntent({
      prompt: "Explain everything we covered",
      currentMaxTokens: 8192,
      adhdAssist: true,
    });

    expect(result.maxTokens).toBe(450);
    expect(result.isLongOutputIntent).toBe(true);
  });
});