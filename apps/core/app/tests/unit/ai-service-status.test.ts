// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  classifyCloudStatus,
  getAiServiceStatus,
  resolveUbcBaseUrls,
} from "~/lib/ai/service-status.server";

describe("classifyCloudStatus", () => {
  it("is offline when no cloud key is present", () => {
    const s = classifyCloudStatus({});
    expect(s.state).toBe("offline");
    expect(s.detail).toMatch(/no cloud api key/i);
  });

  it("is online and names each configured provider", () => {
    const s = classifyCloudStatus({ openai: "sk-x", google: "  ", openrouter: "or-y" });
    expect(s.state).toBe("online");
    expect(s.detail).toContain("OpenAI");
    expect(s.detail).toContain("OpenRouter");
    // Whitespace-only keys are treated as absent.
    expect(s.detail).not.toContain("Google");
  });

  it("treats whitespace-only keys as absent", () => {
    expect(classifyCloudStatus({ openai: "   ", google: null }).state).toBe("offline");
  });
});

describe("resolveUbcBaseUrls", () => {
  it("reads and trims env base URLs", () => {
    const urls = resolveUbcBaseUrls({
      VLLM_BASE_URL: " http://cmps01:8001/v1 ",
      OLLAMA_BASE_URL: "http://localhost:11434/api",
    } as NodeJS.ProcessEnv);
    expect(urls.vllm).toBe("http://cmps01:8001/v1");
    expect(urls.ollama).toBe("http://localhost:11434/api");
  });

  it("returns undefined for unset / blank URLs", () => {
    const urls = resolveUbcBaseUrls({ VLLM_BASE_URL: "   " } as NodeJS.ProcessEnv);
    expect(urls.vllm).toBeUndefined();
    expect(urls.ollama).toBeUndefined();
  });
});

describe("getAiServiceStatus", () => {
  const ENV_KEYS = [
    "OPENAI_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "OPENROUTER_API_KEY",
    "VLLM_BASE_URL",
    "OLLAMA_BASE_URL",
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Fresh module instance per test so the in-memory cache/inFlight state doesn't leak across tests. */
  async function freshModule() {
    vi.resetModules();
    return import("~/lib/ai/service-status.server");
  }

  it("reports cloud offline and ubc offline when nothing is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const mod = await freshModule();

    const status = await mod.getAiServiceStatus();

    expect(status.cloud.state).toBe("offline");
    expect(status.ubc.state).toBe("offline");
    expect(status.ubc.detail).toMatch(/no ubc-hosted inference url configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports cloud online when an API key is present", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal("fetch", vi.fn());
    const mod = await freshModule();

    const status = await mod.getAiServiceStatus();
    expect(status.cloud.state).toBe("online");
    expect(status.cloud.detail).toContain("OpenAI");
  });

  it("reports ubc online when the configured vLLM URL is reachable", async () => {
    process.env.VLLM_BASE_URL = "http://vllm.test";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const mod = await freshModule();

    const status = await mod.getAiServiceStatus();
    expect(status.ubc.state).toBe("online");
    expect(status.ubc.detail).toMatch(/reachable/i);
    expect(fetchMock).toHaveBeenCalledWith("http://vllm.test/models", expect.objectContaining({ method: "GET" }));
  });

  it("reports ubc online when only Ollama is configured and reachable", async () => {
    process.env.OLLAMA_BASE_URL = "http://ollama.test/";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const mod = await freshModule();

    const status = await mod.getAiServiceStatus();
    expect(status.ubc.state).toBe("online");
    expect(fetchMock).toHaveBeenCalledWith("http://ollama.test/tags", expect.objectContaining({ method: "GET" }));
  });

  it("reports ubc offline when configured URLs are unreachable", async () => {
    process.env.VLLM_BASE_URL = "http://vllm.test";
    process.env.OLLAMA_BASE_URL = "http://ollama.test";
    const fetchMock = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);
    const mod = await freshModule();

    const status = await mod.getAiServiceStatus();
    expect(status.ubc.state).toBe("offline");
    expect(status.ubc.detail).toMatch(/configured but unreachable/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches the result so a second call within the TTL does not re-probe", async () => {
    process.env.VLLM_BASE_URL = "http://vllm.test";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const mod = await freshModule();

    await mod.getAiServiceStatus();
    await mod.getAiServiceStatus();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares a single in-flight probe across concurrent callers on a cold cache", async () => {
    process.env.VLLM_BASE_URL = "http://vllm.test";
    let resolveFetch!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(pending);
    vi.stubGlobal("fetch", fetchMock);
    const mod = await freshModule();

    const first = mod.getAiServiceStatus();
    const second = mod.getAiServiceStatus();
    resolveFetch(new Response("{}", { status: 200 }));

    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-probes after the cache TTL expires", async () => {
    process.env.VLLM_BASE_URL = "http://vllm.test";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(0);
    const mod = await freshModule();

    await mod.getAiServiceStatus();
    nowSpy.mockReturnValue(30_001);
    await mod.getAiServiceStatus();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
