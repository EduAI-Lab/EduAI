import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatDailyLimitSettingsCard } from "~/components/settings/chat-daily-limit-settings";
import { defaultChatDailyLimitSettings } from "~/lib/chat-daily-limits";

describe("ChatDailyLimitSettingsCard", () => {
  it("defaults to 50 student messages and 200 instructor messages per day", () => {
    render(
      <ChatDailyLimitSettingsCard
        initialSettings={defaultChatDailyLimitSettings()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/student daily cap/i)).toHaveValue(50);
    expect(screen.getByLabelText(/instructor daily cap/i)).toHaveValue(200);
  });

  it("saves admin-typed limits", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ChatDailyLimitSettingsCard
        initialSettings={defaultChatDailyLimitSettings()}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText(/student daily cap/i), {
      target: { value: "40" },
    });
    fireEvent.change(screen.getByLabelText(/instructor daily cap/i), {
      target: { value: "180" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save daily caps/i }));

    expect(onSave).toHaveBeenCalledWith({
      studentLimit: 40,
      instructorLimit: 180,
    });
  });
});
