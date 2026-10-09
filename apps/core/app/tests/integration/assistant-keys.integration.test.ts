// @vitest-environment node
//
// #1818 against the real test database: the single preference writer, the two
// distinct intents (clearChoice keeps the key, removeKey keeps the choice), the
// stored key being encrypted at rest, deleting an account removing its key rows
// outright, and the #1817 settings seed's real SQL: insert-only, assistant OFF,
// and a rollback that removes only its own keys.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "~/lib/prisma.server";
import {
  clearChoice,
  loadUserAiRows,
  removeKey,
  saveAssistantPreference,
  setUserEnabledModels,
} from "~/lib/assistant/user-ai-keys.server";

const EMAIL = "assistant-keys@integration.test";
let userId: string;

beforeAll(async () => {
  vi.stubEnv("ENCRYPTION_KEY", "assistant-keys-integration-encryption-key");
  for (const name of ["openai", "google"]) {
    await prisma.aIProvider.upsert({
      where: { name },
      create: { name, displayName: name, description: name },
      update: {},
    });
  }
});

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  userId = (await prisma.user.create({ data: { email: EMAIL, name: "Keys", role: "STUDENT" } })).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  vi.unstubAllEnvs();
});

describe("assistant key rows", () => {
  it("keeps exactly one preferred row per user", async () => {
    await saveAssistantPreference(userId, { provider: "openai", model: "gpt-4o-mini" });
    await saveAssistantPreference(userId, { provider: "google", model: "gemini-2.5-flash" });
    const rows = await prisma.userProviderSettings.findMany({ where: { userId } });
    expect(rows.filter((row) => row.preferred)).toHaveLength(1);
    expect((await loadUserAiRows(userId))[0]).toMatchObject({
      provider: "google",
      preferred: true,
    });
  });

  it("stores the key encrypted and reads it back only through the decrypt helper", async () => {
    await saveAssistantPreference(userId, {
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-integration-secret-0001",
    });
    const raw = await prisma.userProviderSettings.findFirst({ where: { userId } });
    expect(raw?.apiKey).not.toContain("sk-integration-secret-0001");
    expect((await loadUserAiRows(userId))[0].key).toBe("sk-integration-secret-0001");
  });

  it("a preference-only row reports no key", async () => {
    await saveAssistantPreference(userId, { provider: "openai", model: "gpt-4o-mini" });
    expect((await loadUserAiRows(userId))[0]).toMatchObject({ key: null, model: "gpt-4o-mini" });
  });

  it("clearChoice returns to the default and KEEPS the key", async () => {
    await saveAssistantPreference(userId, {
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-keep-me-0002",
    });
    await clearChoice(userId);
    const [row] = await loadUserAiRows(userId);
    expect(row).toMatchObject({ key: "sk-keep-me-0002", model: null, preferred: false });
  });

  it("clearChoice deletes a row that has nothing left on it", async () => {
    await saveAssistantPreference(userId, { provider: "openai", model: "gpt-4o-mini" });
    await clearChoice(userId);
    expect(await prisma.userProviderSettings.count({ where: { userId } })).toBe(0);
  });

  it("removeKey deletes the key and KEEPS the provider/model choice", async () => {
    await saveAssistantPreference(userId, {
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-remove-me-0003",
    });
    await removeKey(userId, "openai");
    const [row] = await loadUserAiRows(userId);
    expect(row).toMatchObject({ key: null, model: "gpt-4o-mini", preferred: true });
  });

  it("stores per-user curation, distinguishing never-curated from curated-nothing", async () => {
    await setUserEnabledModels(userId, "openai", []);
    expect((await loadUserAiRows(userId))[0].enabledModels).toEqual([]);
    await setUserEnabledModels(userId, "openai", null);
    expect((await loadUserAiRows(userId))[0].enabledModels).toBeNull();
  });

  it("deleting the account deletes its AI key rows outright", async () => {
    await saveAssistantPreference(userId, {
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-gone-with-user-0004",
    });
    await prisma.user.delete({ where: { id: userId } });
    expect(await prisma.userProviderSettings.count({ where: { userId } })).toBe(0);
  });
});

describe("settings seed migration (#1817), run for real", () => {
  // The integration database is built with `prisma db push`, so the seed has not
  // run here; execute the committed SQL itself against an admin's prior choice.
  const dir = resolve(
    __dirname,
    "../../../prisma/migrations/20261007000100_help_assistant_settings_seed",
  );
  const up = readFileSync(resolve(dir, "migration.sql"), "utf8");
  const down = readFileSync(resolve(dir, "down.sql"), "utf8");
  const UNRELATED = "assistant-seed-test.unrelated";

  async function values() {
    const rows = await prisma.systemConfig.findMany({
      where: { key: { startsWith: "assistant" } },
      select: { key: true, value: true },
    });
    return new Map(rows.map((row) => [row.key, row.value]));
  }

  beforeEach(async () => {
    await prisma.systemConfig.deleteMany({ where: { key: { startsWith: "assistant" } } });
  });

  afterAll(async () => {
    await prisma.systemConfig.deleteMany({ where: { key: { startsWith: "assistant" } } });
  });

  it("seeds defaults with the assistant OFF, and never overwrites an admin's earlier choice", async () => {
    await prisma.systemConfig.create({
      data: { key: "assistant.enable_help_assistant", value: "true", updatedBy: "an-admin" },
    });
    await prisma.$executeRawUnsafe(up);
    await prisma.$executeRawUnsafe(up); // idempotent

    const seeded = await values();
    expect(seeded.get("assistant.enable_help_assistant")).toBe("true");
    expect(seeded.get("assistant.enable_student_material_questions")).toBe("true");
    expect(seeded.get("assistant.ai_assistant_max_docs")).toBe("3");
    expect(seeded.get("assistant.ai_assistant_router_model")).toBe("");

    await prisma.systemConfig.deleteMany({ where: { key: "assistant.enable_help_assistant" } });
    await prisma.$executeRawUnsafe(up);
    expect((await values()).get("assistant.enable_help_assistant")).toBe("false");
  });

  it("rolls back only the keys it seeded", async () => {
    await prisma.$executeRawUnsafe(up);
    await prisma.systemConfig.create({
      data: { key: UNRELATED, value: "keep", updatedBy: "test" },
    });
    await prisma.$executeRawUnsafe(down);
    expect([...(await values()).entries()]).toEqual([[UNRELATED, "keep"]]);
  });
});
