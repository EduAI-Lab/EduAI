import { describe, expect, it } from "vitest";
import {
  dailyLimitForRole,
  defaultChatDailyLimitSettings,
  isLocalChatbotModel,
  parseChatDailyLimit,
} from "~/lib/chat-daily-limits";

describe("isLocalChatbotModel", () => {
  it("treats auto routing and local providers as the local chatbot", () => {
    expect(isLocalChatbotModel(undefined)).toBe(true);
    expect(isLocalChatbotModel("auto")).toBe(true);
    expect(isLocalChatbotModel("auto-llm")).toBe(true);
    expect(isLocalChatbotModel("vllm:qwen2.5-7b-instruct")).toBe(true);
    expect(isLocalChatbotModel("ollama:llama3")).toBe(true);
  });

  it("does not count user-supplied cloud keys", () => {
    expect(isLocalChatbotModel("openai:gpt-4o")).toBe(false);
    expect(isLocalChatbotModel("google:gemini-2.0-flash")).toBe(false);
  });
});

describe("dailyLimitForRole", () => {
  const settings = defaultChatDailyLimitSettings();

  it("defaults students to 50 and instructors to 200", () => {
    expect(settings.studentLimit).toBe(50);
    expect(settings.instructorLimit).toBe(200);
    expect(dailyLimitForRole("STUDENT", settings)).toBe(50);
    expect(dailyLimitForRole("INSTRUCTOR", settings)).toBe(200);
    expect(dailyLimitForRole("ADMIN", settings)).toBe(200);
  });
});

describe("parseChatDailyLimit", () => {
  it("clamps invalid values to the fallback", () => {
    expect(parseChatDailyLimit("", 50)).toBe(50);
    expect(parseChatDailyLimit("nope", 50)).toBe(50);
    expect(parseChatDailyLimit("-3", 50)).toBe(0);
    expect(parseChatDailyLimit("12.9", 50)).toBe(12);
  });
});
