import { fireEvent, render, screen } from "@testing-library/react";
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

  it("renders a chip for each selected option", () => {
    render(
      <MultiSelect options={options} value={["u1", "u3"]} onValueChange={() => {}} />,
    );
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.queryByText("Alan Turing")).not.toBeInTheDocument();
  });

  it("keeps selected chips when server-driven options no longer include them", () => {
    const { rerender } = render(
      <MultiSelect
        options={options}
        value={["u1"]}
        onValueChange={() => {}}
        onSearchChange={() => {}}
      />,
    );
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    // New search result page no longer contains Ada — chip must remain.
    rerender(
      <MultiSelect
        options={[{ value: "u2", label: "Alan Turing", description: "alan@eduai.local" }]}
        value={["u1"]}
        onValueChange={() => {}}
        onSearchChange={() => {}}
      />,
    );
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("disables the trigger when disabled", () => {
    render(
      <MultiSelect options={options} value={[]} onValueChange={vi.fn()} disabled />,
    );
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});

/**
 * #1207 added an opt-in controlled-search mode so a consumer can drive the
 * option list from the SERVER instead of filtering whatever happens to be in
 * memory. The default (uncontrolled, in-memory) behaviour must be untouched —
 * every existing consumer relies on it.
 */
describe("Combobox — server-driven search (#1207)", () => {
  /** Open the dropdown panel; the option list only mounts once open. */
  const openList = () => {
    fireEvent.click(screen.getByRole("combobox"));
  };

  it("filters in memory by default", () => {
    render(<Combobox options={options} value={null} onValueChange={() => {}} />);
    openList();

    fireEvent.change(screen.getByPlaceholderText("Search..."), {
      target: { value: "Grace" },
    });

    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  });

  it("renders every option untouched when filter={false}", () => {
    // The options are already a server-filtered page; filtering again would
    // hide rows the server deliberately returned.
    render(
      <Combobox
        options={options}
        value={null}
        onValueChange={() => {}}
        filter={false}
        searchValue="zzz-matches-nothing-locally"
        onSearchChange={() => {}}
      />,
    );
    openList();

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Alan Turing")).toBeInTheDocument();
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
  });

  it("reports typed characters to onSearchChange", async () => {
    const onSearchChange = vi.fn();
    render(
      <Combobox
        options={options}
        value={null}
        onValueChange={() => {}}
        filter={false}
        searchValue=""
        onSearchChange={onSearchChange}
      />,
    );
    openList();

    fireEvent.change(screen.getByPlaceholderText("Search..."), {
      target: { value: "he" },
    });

    expect(onSearchChange).toHaveBeenCalled();
  });

  it("shows the controlled term in the input", () => {
    render(
      <Combobox
        options={options}
        value={null}
        onValueChange={() => {}}
        filter={false}
        searchValue="heap"
        onSearchChange={() => {}}
      />,
    );
    openList();

    expect(screen.getByPlaceholderText("Search...")).toHaveValue("heap");
  });

  it("shows a searching state instead of the empty text while loading", () => {
    render(
      <Combobox
        options={[]}
        value={null}
        onValueChange={() => {}}
        filter={false}
        searchValue="heap"
        onSearchChange={() => {}}
        loading
        emptyText="No matching activities."
      />,
    );
    openList();

    expect(screen.getByText("Searching…")).toBeInTheDocument();
    expect(screen.queryByText("No matching activities.")).not.toBeInTheDocument();
  });

  it("shows the empty text once loading finishes with no results", () => {
    render(
      <Combobox
        options={[]}
        value={null}
        onValueChange={() => {}}
        filter={false}
        searchValue="heap"
        onSearchChange={() => {}}
        emptyText="No matching activities."
      />,
    );
    openList();

    expect(screen.getByText("No matching activities.")).toBeInTheDocument();
  });

  it("renders a footer under the list for the truncation note", () => {
    render(
      <Combobox
        options={options}
        value={null}
        onValueChange={() => {}}
        filter={false}
        searchValue=""
        onSearchChange={() => {}}
        footer={<>Showing 3 of 812 matches — keep typing to narrow.</>}
      />,
    );
    openList();

    expect(screen.getByText(/showing 3 of 812 matches/i)).toBeInTheDocument();
  });

  it("does not clear a controlled term on select", () => {
    // Clearing it would make the consumer refetch an unfiltered page that may
    // not contain the row just selected, leaving the trigger with no label.
    const onSearchChange = vi.fn();
    render(
      <Combobox
        options={options}
        value={null}
        onValueChange={() => {}}
        filter={false}
        searchValue="grace"
        onSearchChange={onSearchChange}
      />,
    );
    openList();

    fireEvent.mouseDown(screen.getByText("Grace Hopper"));

    expect(onSearchChange).not.toHaveBeenCalledWith("");
  });
});
