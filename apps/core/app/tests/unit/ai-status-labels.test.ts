// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  modelDisplayLabel,
  modelKey,
  serverDisplayLabel,
  serverKey,
  serverSuffix,
} from "~/lib/ai/status/labels";

const FLEET = ["cmps01", "cmps02", "cmps03"];

describe("serverSuffix", () => {
  it("uses the host's trailing digits, zero-padded to two", () => {
    expect(serverSuffix("cmps01", FLEET)).toBe("01");
    expect(serverSuffix("cmps3", ["cmps1", "cmps3"])).toBe("03");
  });

  it("falls back to a stable sorted ordinal for ids without trailing digits", () => {
    const ids = ["gpu-beta", "gpu-alpha"];
    expect(serverSuffix("gpu-alpha", ids)).toBe("01");
    expect(serverSuffix("gpu-beta", ids)).toBe("02");
  });

  it("gives an unknown id a deterministic suffix rather than throwing", () => {
    expect(serverSuffix("nowhere", FLEET)).toBe("00");
  });
});

describe("serverDisplayLabel", () => {
  it("renders Server NN", () => {
    expect(serverDisplayLabel("cmps02", FLEET)).toBe("Server 02");
  });
});

describe("modelDisplayLabel", () => {
  it("renders Family:size-NN", () => {
    expect(modelDisplayLabel("qwen3.5-9b-instruct", "cmps01", FLEET)).toBe("Qwen:9b-01");
    expect(modelDisplayLabel("qwen3.5-2b-instruct", "cmps03", FLEET)).toBe("Qwen:2b-03");
    expect(modelDisplayLabel("qwen3.8-27b-instruct", "cmps02", FLEET)).toBe("Qwen:27b-02");
  });

  it("falls back to the raw model id when family or size cannot be parsed", () => {
    expect(modelDisplayLabel("mystery-model", "cmps01", FLEET)).toBe("mystery-model-01");
  });

  it("uses the same suffix resolver as serverDisplayLabel", () => {
    const ids = ["gpu-beta", "gpu-alpha"];
    expect(modelDisplayLabel("qwen3.5-9b-instruct", "gpu-beta", ids)).toBe("Qwen:9b-02");
    expect(serverDisplayLabel("gpu-beta", ids)).toBe("Server 02");
  });
});

describe("keys", () => {
  it("are url-safe and stable", () => {
    expect(serverKey("cmps01", FLEET)).toBe("server-01");
    expect(modelKey("qwen3.5-9b-instruct", "cmps01", FLEET)).toBe("qwen-9b-01");
  });
});
