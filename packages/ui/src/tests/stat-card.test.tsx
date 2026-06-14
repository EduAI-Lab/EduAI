import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatCard } from "../stat-card";

describe("StatCard", () => {
  it("renders label and value", () => {
    render(<StatCard label="Active Students" value="4,532" />);
    expect(screen.getByText("Active Students")).toBeInTheDocument();
    expect(screen.getByText("4,532")).toBeInTheDocument();
  });

  it("renders numeric value", () => {
    render(<StatCard label="Courses" value={42} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders positive trend with upward arrow", () => {
    render(<StatCard label="Growth" value="150" trend={15} />);
    expect(screen.getByText("↑ 15%")).toBeInTheDocument();
  });

  it("renders negative trend with downward arrow", () => {
    render(<StatCard label="Churn" value="50" trend={-10} />);
    expect(screen.getByText("↓ 10%")).toBeInTheDocument();
  });

  it("renders zero trend with dash", () => {
    render(<StatCard label="Neutral" value="100" trend={0} />);
    expect(screen.getByText("— 0%")).toBeInTheDocument();
  });

  it("renders trend label when provided", () => {
    render(
      <StatCard
        label="Monthly Active Users"
        value="5,200"
        trend={12}
        trendLabel="vs last month"
      />
    );
    expect(screen.getByText("vs last month")).toBeInTheDocument();
  });

  it("does not render trend badge when trend is undefined", () => {
    const { container } = render(
      <StatCard label="Total Users" value="10,000" />
    );
    const trendBadge = container.querySelector("span");
    // The component should not have a trend badge span when trend is undefined
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("applies custom style to the card", () => {
    const { container } = render(
      <StatCard label="Test" value="100" style={{ padding: "20px" }} />
    );
    const card = container.querySelector("div");
    expect(card).toHaveStyle({ padding: "20px" });
  });
});
