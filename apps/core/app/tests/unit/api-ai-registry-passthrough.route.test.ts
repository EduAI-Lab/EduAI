// @vitest-environment node
// #1213 — /api/ai-models/$ and /api/ai-providers/$: thin passthroughs to a
// dynamically-imported handler for both loader and action. Existing
// ai-config.rbac.test.ts exercises the loader; this adds the action branch.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/api/ai-models-api.server", () => ({
  handleAiModelsApiRequest: vi.fn(),
}));

vi.mock("~/lib/api/ai-providers-api.server", () => ({
  handleAiProvidersApiRequest: vi.fn(),
}));

import { action as aiModelsAction } from "~/routes/api/ai-models.$";
import { action as aiProvidersAction } from "~/routes/api/ai-providers.$";
import { handleAiModelsApiRequest } from "~/lib/api/ai-models-api.server";
import { handleAiProvidersApiRequest } from "~/lib/api/ai-providers-api.server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/ai-models/$ and /api/ai-providers/$ action", () => {
  it("delegates to handleAiModelsApiRequest", async () => {
    const response = new Response(null, { status: 201 });
    vi.mocked(handleAiModelsApiRequest).mockResolvedValue(response);
    const request = new Request("http://localhost/api/ai-models", { method: "POST" });
    const res = await aiModelsAction({ request, params: {}, context: {} as never } as never);
    expect(res).toBe(response);
    expect(handleAiModelsApiRequest).toHaveBeenCalledWith(request);
  });

  it("delegates to handleAiProvidersApiRequest", async () => {
    const response = new Response(null, { status: 201 });
    vi.mocked(handleAiProvidersApiRequest).mockResolvedValue(response);
    const request = new Request("http://localhost/api/ai-providers", { method: "POST" });
    const res = await aiProvidersAction({ request, params: {}, context: {} as never } as never);
    expect(res).toBe(response);
    expect(handleAiProvidersApiRequest).toHaveBeenCalledWith(request);
  });
});
