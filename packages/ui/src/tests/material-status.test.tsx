import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MaterialStatusIcon, MaterialStatusChip, type MaterialStatus } from "../material-status";

describe("MaterialStatusIcon", () => {
  it("renders a spinning loader for PROCESSING", () => {
    const { container } = render(<MaterialStatusIcon status="PROCESSING" />);
    const icon = container.querySelector("svg");
    expect(icon).toBeInTheDocument();
    expect(icon?.getAttribute("class")).toContain("animate-spin");
    expect(icon?.getAttribute("class")).toContain("text-yellow-500");
  });

  it("renders a green check for READY", () => {
    const { container } = render(<MaterialStatusIcon status="READY" />);
    const icon = container.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("text-green-500");
  });

  it("renders a red x for FAILED", () => {
    const { container } = render(<MaterialStatusIcon status="FAILED" />);
    const icon = container.querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("text-red-500");
  });

  it("falls back to a muted file icon for an unknown status", () => {
    const { container } = render(
      <MaterialStatusIcon status={"SOMETHING_ELSE" as unknown as MaterialStatus} />,
    );
    const icon = container.querySelector("svg");
    expect(icon).toBeInTheDocument();
    expect(icon?.getAttribute("class")).toContain("text-muted-foreground");
  });
});

describe("MaterialStatusChip", () => {
  it("labels READY as 'Embedded'", () => {
    const { getByText } = render(<MaterialStatusChip status="READY" />);
    expect(getByText("Embedded")).toBeInTheDocument();
  });

  it("labels PROCESSING as 'Processing'", () => {
    const { getByText } = render(<MaterialStatusChip status="PROCESSING" />);
    expect(getByText("Processing")).toBeInTheDocument();
  });

  it("labels FAILED as 'Failed'", () => {
    const { getByText } = render(<MaterialStatusChip status="FAILED" />);
    expect(getByText("Failed")).toBeInTheDocument();
  });

  it("falls back to 'Unknown' for an unrecognized status", () => {
    const { getByText } = render(
      <MaterialStatusChip status={"SOMETHING_ELSE" as unknown as MaterialStatus} />,
    );
    expect(getByText("Unknown")).toBeInTheDocument();
  });
});
