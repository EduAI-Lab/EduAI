import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BedrockOverflowSettingsCard } from "~/components/settings/bedrock-overflow-settings";
import { defaultBedrockOverflowSettings } from "~/lib/ai/routing/bedrock/bedrock-settings";

describe("BedrockOverflowSettingsCard", () => {
  it("shows the cost warning, keeps AWS off, and defaults caps to 0", () => {
    render(
      <BedrockOverflowSettingsCard
        initialSettings={defaultBedrockOverflowSettings()}
        tokenConfigured
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText(/this can incur aws charges/i)).toBeInTheDocument();
    expect(screen.getByText(/paid fallback only/i)).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /enable aws bedrock overflow/i })).not.toBeChecked();
    expect(screen.getByLabelText(/daily cap per user/i)).toHaveValue(0);
    expect(screen.getByLabelText(/monthly cap per user/i)).toHaveValue(0);
    expect(screen.getByLabelText(/global monthly cap/i)).toHaveValue(0);
    expect(screen.getByLabelText(/burst \/ resource limit/i)).toHaveValue(0);
  });

  it("warns when the AWS token is missing", () => {
    render(
      <BedrockOverflowSettingsCard
        initialSettings={defaultBedrockOverflowSettings()}
        tokenConfigured={false}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText(/aws token is not configured/i)).toBeInTheDocument();
  });

  it("saves the admin-typed limits", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <BedrockOverflowSettingsCard
        initialSettings={defaultBedrockOverflowSettings()}
        tokenConfigured
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: /enable aws bedrock overflow/i }));
    fireEvent.change(screen.getByLabelText(/daily cap per user/i), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save aws limits/i }));

    expect(onSave).toHaveBeenCalledWith({
      ...defaultBedrockOverflowSettings(),
      enabled: true,
      dailyUserLimit: 5,
    });
  });
});
