// @vitest-environment node
/**
 * #1823: the shared live list-models call — the key travels in a header, never
 * a URL, and each provider's list is normalized once.
 * #1817: the settings seed is insert-only, ships the help assistant OFF, and its
 * rollback removes only the keys it seeds.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { listProviderModels } from "~/lib/ai/list-provider-models.server";
import {
  ASSISTANT_SETTING_STORAGE_KEYS,
  clampMaxDocs,
  defaultAssistantSettings,
  parseAssistantSettings,
} from "~/lib/assistant/assistant-settings";
import type { RouteRequestBody } from "../helpers/route-fixtures";

const KEY = "sk-user-own-key-1234";

function fakeFetch(body: RouteRequestBody, status = 200) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe("listProviderModels", () => {
  it.each(["openai", "google", "opencode"] as const)(
    "%s: puts the key in a header and never in the URL",
    async (provider) => {
      const fetchImpl = fakeFetch({ data: [], models: [] });
      await listProviderModels(provider, KEY, fetchImpl);
      const [url, init] = fetchImpl.mock.calls[0];
      expect(String(url)).not.toContain(KEY);
      expect(JSON.stringify(init.headers)).toContain(KEY);
    },
  );

  it("keeps OpenAI's chat families and drops embeddings/audio models", async () => {
    const fetchImpl = fakeFetch({
      data: [
        { id: "gpt-4o-mini" },
        { id: "text-embedding-3-small" },
        { id: "o3-mini" },
        { id: "whisper-1" },
      ],
    });
    await expect(listProviderModels("openai", KEY, fetchImpl)).resolves.toEqual({
      ok: true,
      models: ["gpt-4o-mini", "o3-mini"],
    });
  });

  it("normalizes Gemini ids and keeps only content generators", async () => {
    const fetchImpl = fakeFetch({
      models: [
        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
      ],
    });
    await expect(listProviderModels("google", KEY, fetchImpl)).resolves.toEqual({
      ok: true,
      models: ["gemini-2.5-flash"],
    });
  });

  it("reports a refused key and an unreachable provider distinctly", async () => {
    await expect(listProviderModels("openai", KEY, fakeFetch({}, 401))).resolves.toEqual({
      ok: false,
      reason: "rejected",
      status: 401,
    });
    await expect(
      listProviderModels("openai", KEY, vi.fn().mockRejectedValue(new TypeError("fetch failed"))),
    ).resolves.toEqual({ ok: false, reason: "unreachable" });
  });

  it("refuses providers with no user-listable catalogue", async () => {
    const fetchImpl = vi.fn();
    await expect(listProviderModels("vllm", KEY, fetchImpl)).resolves.toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("assistant settings", () => {
  it("defaults the help assistant OFF and the student material toggle ON", () => {
    expect(defaultAssistantSettings()).toEqual({
      enableHelpAssistant: false,
      enableStudentMaterialQuestions: true,
      maxDocs: 3,
      routerModel: "",
      defaultModel: "",
    });
    expect(parseAssistantSettings(new Map())).toEqual(defaultAssistantSettings());
  });

  it("clamps maxDocs to 1..5 and drops unsafe model ids on read", () => {
    expect(clampMaxDocs(0)).toBe(1);
    expect(clampMaxDocs(9)).toBe(5);
    expect(clampMaxDocs("nonsense")).toBe(3);
    const parsed = parseAssistantSettings(
      new Map([
        [ASSISTANT_SETTING_STORAGE_KEYS.maxDocs, "42"],
        [ASSISTANT_SETTING_STORAGE_KEYS.routerModel, "openai:../../admin"],
        [ASSISTANT_SETTING_STORAGE_KEYS.defaultModel, "openai:gpt-4o-mini"],
      ]),
    );
    expect(parsed).toMatchObject({
      maxDocs: 5,
      routerModel: "",
      defaultModel: "openai:gpt-4o-mini",
    });
  });
});

describe("settings seed migration", () => {
  const dir = path.join(
    __dirname,
    "../../../prisma/migrations/20261007000100_help_assistant_settings_seed",
  );
  const up = fs.readFileSync(path.join(dir, "migration.sql"), "utf8");
  const down = fs.readFileSync(path.join(dir, "down.sql"), "utf8");
  const seeded = [
    "assistant.enable_help_assistant",
    "assistant.enable_student_material_questions",
    "assistant.ai_assistant_max_docs",
    "assistant.ai_assistant_router_model",
  ];

  it("is insert-only, so an admin's earlier choice is never overwritten", () => {
    expect(up).toMatch(/ON CONFLICT \("key"\) DO NOTHING/);
    expect(up).not.toMatch(/\bUPDATE\b|DO UPDATE|\bDELETE\b/i);
  });

  it("seeds the four spec settings with the help assistant OFF", () => {
    for (const key of seeded) expect(up).toContain(`'${key}'`);
    expect(up).toMatch(/'assistant\.enable_help_assistant', 'false'/);
  });

  it("rolls back only the keys it seeded", () => {
    const named = [...down.matchAll(/'([^']+)'/g)].map((match) => match[1]);
    expect(new Set(named)).toEqual(new Set(seeded));
    expect(named).toHaveLength(seeded.length);
    expect(down).toMatch(/WHERE "key" IN/);
  });
});
