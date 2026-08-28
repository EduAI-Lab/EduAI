import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RoutingModelsTable } from "~/components/admin/routing-models-table";
import { routingModelSettingDefinitions } from "~/lib/routing-model-settings";

describe("RoutingModelsTable", () => {
  it("shows both routing modes with explanatory tooltips", () => {
    render(
      <RoutingModelsTable
        definitions={routingModelSettingDefinitions()}
        settings={{ autoLlmEnabled: true, autoRulesEnabled: false }}
        onToggle={vi.fn()}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.getByText("Auto")).toBeInTheDocument();
    expect(screen.getByText("Auto (rules)")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "About Auto" })).toHaveAccessibleDescription(
      /lightweight classifier/i,
    );
    expect(screen.getByRole("button", { name: "About Auto (rules)" })).toHaveAccessibleDescription(
      /fixed prompt, image, tool/i,
    );
  });

  it("lets admins enable the rule-based routing mode", () => {
    const onToggle = vi.fn();
    render(
      <RoutingModelsTable
        definitions={routingModelSettingDefinitions()}
        settings={{ autoLlmEnabled: true, autoRulesEnabled: false }}
        onToggle={onToggle}
        onEdit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: "Enable Auto (rules)" }));
    expect(onToggle).toHaveBeenCalledWith("autoRulesEnabled", true);
  });

  it("opens Auto model configuration from the Auto row", () => {
    const onEdit = vi.fn();
    render(
      <RoutingModelsTable
        definitions={routingModelSettingDefinitions()}
        settings={{ autoLlmEnabled: true, autoRulesEnabled: false }}
        onToggle={vi.fn()}
        onEdit={onEdit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit Auto models" }));
    expect(onEdit).toHaveBeenCalledOnce();
  });
});
