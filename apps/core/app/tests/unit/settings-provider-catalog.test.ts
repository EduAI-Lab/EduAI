import { describe, expect, it } from "vitest";

import { SETTINGS_KEY_PROVIDERS } from "~/components/settings/settings-view";

describe("settings provider catalog", () => {
  it("offers every supported account-scoped cloud key, including OpenCode Go", () => {
    expect(SETTINGS_KEY_PROVIDERS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "openai" }),
        expect.objectContaining({ id: "google" }),
        expect.objectContaining({
          id: "opencode",
          label: "OpenCode Go",
          placeholder: "OpenCode Go API key",
        }),
      ]),
    );
  });
});
