import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { QuestionStatusBadge, questionStatus } from "../question-status-badge";

describe("questionStatus", () => {
  it("maps draft to the warning variant", () => {
    expect(questionStatus(true)).toEqual({ label: "Draft", variant: "warning" });
  });

  it("maps reviewed to the success variant", () => {
    expect(questionStatus(false)).toEqual({ label: "Reviewed", variant: "success" });
  });
});

describe("QuestionStatusBadge", () => {
  it("renders Draft when isDraft is true", () => {
    render(<QuestionStatusBadge isDraft={true} />);
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("renders Reviewed when isDraft is false", () => {
    render(<QuestionStatusBadge isDraft={false} />);
    expect(screen.getByText("Reviewed")).toBeInTheDocument();
  });

  it("applies a custom className", () => {
    render(<QuestionStatusBadge isDraft={true} className="custom-status" />);
    expect(screen.getByText("Draft").closest(".custom-status")).toBeInTheDocument();
  });
});
