import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Combobox, MultiSelect, type ComboboxOption } from "../ui/combobox";

const options: ComboboxOption[] = [
  { value: "u1", label: "Ada Lovelace", description: "ada@eduai.local" },
  { value: "u2", label: "Alan Turing", description: "alan@eduai.local" },
  { value: "u3", label: "Grace Hopper", description: "grace@eduai.local" },
];

describe("Combobox", () => {
  it("shows the placeholder when nothing is selected", () => {
    render(
      <Combobox
        options={options}
        value={null}
        onValueChange={() => {}}
        placeholder="Pick a person"
      />,
    );
    expect(screen.getByText("Pick a person")).toBeInTheDocument();
  });

  it("shows the selected option's label", () => {
    render(<Combobox options={options} value="u2" onValueChange={() => {}} />);
    expect(screen.getByText("Alan Turing")).toBeInTheDocument();
  });

  it("disables the trigger when disabled", () => {
    render(
      <Combobox options={options} value={null} onValueChange={() => {}} disabled />,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});

describe("MultiSelect", () => {
  it("shows the placeholder when no options are selected", () => {
    render(
      <MultiSelect
        options={options}
        value={[]}
        onValueChange={() => {}}
        placeholder="Add staff"
      />,
    );
    expect(screen.getByText("Add staff")).toBeInTheDocument();
  });

  it("summarises the number of selected options", () => {
    render(
      <MultiSelect options={options} value={["u1", "u3"]} onValueChange={() => {}} />,
    );
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("disables the trigger when disabled", () => {
    render(
      <MultiSelect options={options} value={[]} onValueChange={vi.fn()} disabled />,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});
