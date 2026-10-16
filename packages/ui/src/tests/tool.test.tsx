import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Tool } from "../ui/tool";

const toolPart = {
  type: "getInformation",
  state: "output-available" as const,
  input: { question: "When is Lab 14 due?" },
  output: { relevantContent: [{ content: "Lab 14 is due Nov 20.", materialTitle: "L14.pdf" }] },
  toolCallId: "call-1",
};

describe("Tool", () => {
  it("expands to show the input and output by default", () => {
    render(<Tool toolPart={toolPart} displayName="Searching course materials…" />);

    fireEvent.click(screen.getByRole("button", { name: /Searching course materials/ }));

    expect(screen.getByText(/L14\.pdf/)).toBeInTheDocument();
  });

  it("renders only the status row when not collapsible (#1963)", () => {
    render(
      <Tool toolPart={toolPart} displayName="Searching course materials…" collapsible={false} />,
    );

    expect(screen.getByText("Searching course materials…")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/L14\.pdf/)).not.toBeInTheDocument();
    expect(screen.queryByText(/call-1/)).not.toBeInTheDocument();
  });
});
