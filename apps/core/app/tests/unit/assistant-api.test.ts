// @vitest-environment node
/**
 * #1823: removing a saved key goes through `DELETE /api/assistant/settings`, not
 * the save path, so a self-curated model can't make the removal fail validation.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { removeAssistantKey } from "~/components/assistant/assistant-api";

afterEach(() => vi.unstubAllGlobals());

describe("removeAssistantKey", () => {
  it("sends DELETE with only the provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ providers: [], preferred: null, effective: null }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await removeAssistantKey("openai");

    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/assistant/settings");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body)).toEqual({ provider: "openai" });
  });
});
