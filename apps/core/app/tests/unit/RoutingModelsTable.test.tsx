import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RoutingModelsTable } from "~/components/admin/routing-models-table";
import { routingModelSettingDefinitions } from "~/lib/routing-model-settings";

describe("RoutingModelsTable", () => {
  it("shows both routing modes with explanatory tooltips", async () => {
    render(
      <RoutingModelsTable
        definitions={routingModelSettingDefinitions()}
        settings={{ autoLlmEnabled: true, autoRulesEnabled: false }}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByText("Auto")).toBeInTheDocument();
    expect(screen.getByText("Auto (rules)")).toBeInTheDocument();

    fireEvent.mouseOver(screen.getByRole("button", { name: "About Auto" }));
    expect(
      await screen.findByText(/lightweight LLM classifier/i),
    ).toBeInTheDocument();

    fireEvent.mouseOver(
      screen.getByRole("button", { name: "About Auto (rules)" }),
    );
    expect(
      await screen.findByText(/fixed prompt, image, tool/i),
    ).toBeInTheDocument();
  });

  it("lets admins enable the rule-based routing mode", () => {
    const onToggle = vi.fn();
    render(
      <RoutingModelsTable
        definitions={routingModelSettingDefinitions()}
        settings={{ autoLlmEnabled: true, autoRulesEnabled: false }}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(
      screen.getByRole("switch", { name: "Enable Auto (rules)" }),
    );
    expect(onToggle).toHaveBeenCalledWith("autoRulesEnabled", true);
  });
});
