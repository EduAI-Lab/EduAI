import { describe, expect, it } from "vitest";
import { authClient } from "~/lib/auth/client";

describe("Better Auth apiKey client plugin", () => {
  it("exposes list/create/delete helpers for Settings server keys", () => {
    expect(authClient.apiKey).toBeDefined();
    expect(authClient.apiKey.list).toEqual(expect.any(Function));
    expect(authClient.apiKey.create).toEqual(expect.any(Function));
    expect(authClient.apiKey.delete).toEqual(expect.any(Function));
  });
});
