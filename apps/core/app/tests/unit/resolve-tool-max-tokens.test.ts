import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  resolveToolMaxOutputTokens,
  toolMaxOutputTokensEnvCap,
} from "~/lib/ai/resolve-tool-max-tokens";

describe("resolveToolMaxOutputTokens", () => {
  const original = process.env.CHAT_TOOL_MAX_OUTPUT_TOKENS;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CHAT_TOOL_MAX_OUTPUT_TOKENS;
    } else {
      process.env.CHAT_TOOL_MAX_OUTPUT_TOKENS = original;
    }
  });

  it("defaults env cap to 8192 when unset", () => {
    delete process.env.CHAT_TOOL_MAX_OUTPUT_TOKENS;
    expect(toolMaxOutputTokensEnvCap()).toBe(8192);
    expect(resolveToolMaxOutputTokens()).toBe(8192);
  });

  it("respects CHAT_TOOL_MAX_OUTPUT_TOKENS env override", () => {
    process.env.CHAT_TOOL_MAX_OUTPUT_TOKENS = "4096";
    expect(resolveToolMaxOutputTokens()).toBe(4096);
  });

  it("caps env limit against model maxTokens from DB", () => {
    delete process.env.CHAT_TOOL_MAX_OUTPUT_TOKENS;
    expect(resolveToolMaxOutputTokens(8192)).toBe(8192);
    expect(resolveToolMaxOutputTokens(4096)).toBe(4096);
  });

  it("uses model limit when env cap is higher", () => {
    process.env.CHAT_TOOL_MAX_OUTPUT_TOKENS = "32000";
    expect(resolveToolMaxOutputTokens(8192)).toBe(8192);
  });

  it("ignores invalid model maxTokens", () => {
    delete process.env.CHAT_TOOL_MAX_OUTPUT_TOKENS;
    expect(resolveToolMaxOutputTokens(0)).toBe(8192);
    expect(resolveToolMaxOutputTokens(null)).toBe(8192);
  });
});
