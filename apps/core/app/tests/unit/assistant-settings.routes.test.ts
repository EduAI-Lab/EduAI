// @vitest-environment node
/**
 * #1823 + #1817: the settings-pane routes and the admin settings route.
 * - no response ever contains key material, and a rejected save echoes nothing;
 * - a save returns freshly re-read state, not the request;
 * - fetching live models needs the user's OWN key, with a message that says why;
 * - the pane is reachable and saveable while the assistant toggle is off;
 * - a user without their own key cannot pick a model outside the admin catalogue;
 * - the admin route is ADMIN-only on BOTH read and write.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth/server", () => ({ auth: { api: { getSession: vi.fn() } } }));

const rateMock = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock("~/lib/auth/rate-limit.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth/rate-limit.server")>()),
  checkRateLimit: rateMock.checkRateLimit,
}));

const keysMock = vi.hoisted(() => ({
  loadUserAiRows: vi.fn(),
  saveAssistantPreference: vi.fn(),
  setUserEnabledModels: vi.fn(),
  clearChoice: vi.fn(),
  removeKey: vi.fn(),
}));
vi.mock("~/lib/assistant/user-ai-keys.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/assistant/user-ai-keys.server")>()),
  ...keysMock,
}));

const catalogueMock = vi.hoisted(() => ({ loadAssistantCatalogue: vi.fn() }));
vi.mock("~/lib/assistant/provider-choice.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/assistant/provider-choice.server")>()),
  loadAssistantCatalogue: catalogueMock.loadAssistantCatalogue,
}));

const settingsMock = vi.hoisted(() => ({
  getAssistantSettings: vi.fn(),
  updateAssistantSettings: vi.fn(),
}));
vi.mock("~/lib/assistant/assistant-settings.server", () => settingsMock);

const policyMock = vi.hoisted(() => ({ getPolicy: vi.fn() }));
vi.mock("~/lib/policy.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/policy.server")>()),
  getPolicy: policyMock.getPolicy,
}));

const listMock = vi.hoisted(() => ({ listProviderModels: vi.fn() }));
vi.mock("~/lib/ai/list-provider-models.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/ai/list-provider-models.server")>()),
  listProviderModels: listMock.listProviderModels,
}));

// requireAdmin re-reads the admin's row; this one is active.
vi.mock("~/lib/prisma.server", () => ({
  default: { user: { findUnique: vi.fn().mockResolvedValue({ isActive: true, role: "ADMIN" }) } },
}));
vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logAuditAction: vi.fn(),
  logSecurityEvent: vi.fn(),
}));

import { auth } from "~/lib/auth/server";
import { defaultAssistantSettings } from "~/lib/assistant/assistant-settings";
import {
  loader as settingsLoader,
  action as settingsAction,
} from "~/routes/api/assistant.settings";
import { action as resetAction } from "~/routes/api/assistant.settings.reset";
import { action as modelsAction } from "~/routes/api/assistant.settings.models";
import {
  loader as adminLoader,
  action as adminAction,
} from "~/routes/api/admin.assistant-settings";
import type { RouteRequestBody } from "../helpers/route-fixtures";

const SECRET = "sk-user-secret-key-abcd";

function req(url: string, method = "GET", body?: RouteRequestBody) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return { request: new Request(`http://localhost${url}`, init) } as never;
}

function signIn(role = "STUDENT") {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "u1", role, email: "u1@example.com" },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.OPENAI_API_KEY;
  signIn();
  rateMock.checkRateLimit.mockResolvedValue({ limited: false, retryAfter: 0 });
  policyMock.getPolicy.mockResolvedValue(true);
  // The assistant toggle is OFF throughout — the pane must still work.
  settingsMock.getAssistantSettings.mockResolvedValue(defaultAssistantSettings());
  catalogueMock.loadAssistantCatalogue.mockResolvedValue([
    { name: "openai", displayName: "OpenAI", models: ["gpt-4o-mini"] },
  ]);
  keysMock.loadUserAiRows.mockResolvedValue([
    {
      id: "r1",
      provider: "openai",
      key: SECRET,
      model: "gpt-4o-mini",
      preferred: true,
      enabledModels: null,
    },
  ]);
});

describe("GET /api/assistant/settings", () => {
  it("is reachable with the assistant toggle off and never returns the key", async () => {
    const res = (await settingsLoader(req("/api/assistant/settings"))) as Response;
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    const body = JSON.parse(text);
    expect(body.providers[0]).toMatchObject({ hasOwnKey: true, maskedKey: "••••••••abcd" });
    expect(body.effective).toMatchObject({ provider: "openai", keySource: "SAVED" });
  });

  it("is throttled loosely (60/min) compared with the writes", async () => {
    await settingsLoader(req("/api/assistant/settings"));
    expect(rateMock.checkRateLimit).toHaveBeenCalledWith("assistant-settings-read:u1", 60, 60_000);
  });
});

describe("POST /api/assistant/settings", () => {
  it("saves and returns freshly re-read state, never the request or the key", async () => {
    const res = (await settingsAction(
      req("/api/assistant/settings", "POST", {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-brand-new-key-9876",
      }),
    )) as Response;
    expect(res.status).toBe(200);
    expect(keysMock.saveAssistantPreference).toHaveBeenCalledWith("u1", {
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-brand-new-key-9876",
      removeKey: false,
    });
    // The second loadUserAiRows call is the re-read after the write.
    expect(keysMock.loadUserAiRows).toHaveBeenCalledTimes(2);
    const text = await res.text();
    expect(text).not.toContain("sk-brand-new-key-9876");
    expect(text).not.toContain(SECRET);
    expect(rateMock.checkRateLimit).toHaveBeenCalledWith("assistant-settings-write:u1", 20, 60_000);
  });

  it("a rejected save never echoes the submitted key back", async () => {
    const res = (await settingsAction(
      req("/api/assistant/settings", "POST", {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-" + "x".repeat(600),
      }),
    )) as Response;
    expect(res.status).toBe(422);
    expect(await res.text()).not.toContain("xxxxxxxx");
    expect(keysMock.saveAssistantPreference).not.toHaveBeenCalled();
  });

  it("a user without their own key cannot pick a model outside the admin catalogue", async () => {
    keysMock.loadUserAiRows.mockResolvedValue([]);
    process.env.OPENAI_API_KEY = "sk-platform";
    const res = (await settingsAction(
      req("/api/assistant/settings", "POST", {
        provider: "openai",
        model: "gpt-4.1-withheld",
        enabledModels: ["gpt-4.1-withheld"],
      }),
    )) as Response;
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/administrator's catalogue/);
    expect(keysMock.saveAssistantPreference).not.toHaveBeenCalled();
  });

  it("a user WITH their own key may run a model they enabled", async () => {
    const res = (await settingsAction(
      req("/api/assistant/settings", "POST", {
        provider: "openai",
        model: "gpt-4.1",
        enabledModels: ["gpt-4.1"],
      }),
    )) as Response;
    expect(res.status).toBe(200);
    expect(keysMock.setUserEnabledModels).toHaveBeenCalledWith("u1", "openai", ["gpt-4.1"]);
  });

  it("refuses a provider the administrator has not enabled", async () => {
    const res = (await settingsAction(
      req("/api/assistant/settings", "POST", { provider: "google", model: "gemini-2.5-flash" }),
    )) as Response;
    expect(res.status).toBe(422);
  });
});

describe("POST /api/assistant/settings/reset", () => {
  it("clears the choice (keeping keys) and returns re-read state", async () => {
    const res = (await resetAction(req("/api/assistant/settings/reset", "POST"))) as Response;
    expect(res.status).toBe(200);
    expect(keysMock.clearChoice).toHaveBeenCalledWith("u1");
    expect(keysMock.removeKey).not.toHaveBeenCalled();
  });
});

describe("POST /api/assistant/settings/models", () => {
  it("refuses without a personal key, saying why — the platform key is never used", async () => {
    keysMock.loadUserAiRows.mockResolvedValue([]);
    process.env.OPENAI_API_KEY = "sk-platform";
    const res = (await modelsAction(
      req("/api/assistant/settings/models", "POST", { provider: "openai" }),
    )) as Response;
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("no_own_key");
    expect(body.error).toMatch(/your own API key/);
    expect(listMock.listProviderModels).not.toHaveBeenCalled();
  });

  it("lists with the user's own key, throttled at 10/min, and writes nothing", async () => {
    listMock.listProviderModels.mockResolvedValue({ ok: true, models: ["gpt-4.1", "gpt-4o-mini"] });
    const res = (await modelsAction(
      req("/api/assistant/settings/models", "POST", { provider: "openai" }),
    )) as Response;
    expect(res.status).toBe(200);
    expect(listMock.listProviderModels).toHaveBeenCalledWith("openai", SECRET);
    expect(keysMock.setUserEnabledModels).not.toHaveBeenCalled();
    expect(rateMock.checkRateLimit).toHaveBeenCalledWith(
      "assistant-settings-models:u1",
      10,
      60_000,
    );
  });

  it("is stopped by the platform kill switch", async () => {
    policyMock.getPolicy.mockResolvedValue(false);
    const res = (await modelsAction(
      req("/api/assistant/settings/models", "POST", { provider: "openai" }),
    )) as Response;
    expect(res.status).toBe(403);
  });
});

describe("/api/admin/assistant-settings — ADMIN only on read AND write", () => {
  it.each(["STUDENT", "INSTRUCTOR", "UNIT_ADMIN"])(
    "%s is refused on GET and PATCH",
    async (role) => {
      signIn(role);
      const read = (await adminLoader(req("/api/admin/assistant-settings"))) as Response;
      const write = (await adminAction(
        req("/api/admin/assistant-settings", "PATCH", { enableHelpAssistant: true }),
      )) as Response;
      expect(read.status).toBe(403);
      expect(write.status).toBe(403);
      expect(settingsMock.updateAssistantSettings).not.toHaveBeenCalled();
    },
  );

  it("an ADMIN can read and write; the write re-checks the role itself", async () => {
    signIn("ADMIN");
    settingsMock.updateAssistantSettings.mockResolvedValue({
      ...defaultAssistantSettings(),
      enableHelpAssistant: true,
    });
    const read = (await adminLoader(req("/api/admin/assistant-settings"))) as Response;
    expect(read.status).toBe(200);
    const write = (await adminAction(
      req("/api/admin/assistant-settings", "PATCH", { enableHelpAssistant: true, maxDocs: 4 }),
    )) as Response;
    expect(write.status).toBe(200);
    expect(settingsMock.updateAssistantSettings).toHaveBeenCalledWith(
      { enableHelpAssistant: true, maxDocs: 4 },
      "u1",
    );
  });

  it("rejects an out-of-range maxDocs and an unsafe model id", async () => {
    signIn("ADMIN");
    for (const body of [
      { maxDocs: 9 },
      { maxDocs: 0 },
      { routerModel: "openai:../../v1/x" },
      { routerModel: "a b" },
    ]) {
      const res = (await adminAction(
        req("/api/admin/assistant-settings", "PATCH", body),
      )) as Response;
      expect(res.status).toBe(400);
    }
    expect(settingsMock.updateAssistantSettings).not.toHaveBeenCalled();
  });
});
