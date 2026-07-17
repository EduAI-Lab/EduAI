import { describe, expect, it } from "vitest";
import { authClient } from "~/lib/auth/client";

describe("Better Auth apiKey client plugin", () => {
  it("exposes list/create/delete helpers for Settings server keys", () => {
    expect(authClient.apiKey).toBeDefined();
    expect(typeof authClient.apiKey.list).toBe("function");
    expect(typeof authClient.apiKey.create).toBe("function");
    expect(typeof authClient.apiKey.delete).toBe("function");
  });
});
