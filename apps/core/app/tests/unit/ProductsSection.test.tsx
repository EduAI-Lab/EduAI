import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ProductsSection } from "~/components/products-section";

/**
 * The Platform/Extension badge is derived from each product's own `kind`, so
 * the label and its emphasis cannot drift apart: there is no separate
 * "featured" flag a caller could forget to pass, or pass to the wrong card.
 */
describe("ProductsSection", () => {
  it("labels the platform card from the product's kind", () => {
    render(<ProductsSection />);

    const platform = screen.getByRole("heading", { name: "EduAI" }).closest("div[class]");
    expect(platform).not.toBeNull();
    expect(screen.getAllByText("Platform")).toHaveLength(1);
  });

  it("labels every other product as an extension", () => {
    render(<ProductsSection />);

    expect(screen.getByRole("heading", { name: "AI Tutor" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Question Maker" })).toBeInTheDocument();
    expect(screen.getAllByText("Extension").length).toBeGreaterThanOrEqual(2);
  });

  it("exposes the #products anchor the header links to", () => {
    const { container } = render(<ProductsSection />);
    expect(container.querySelector("#products")).not.toBeNull();
  });

  it("keeps the long write-up behind a Learn more disclosure", () => {
    render(<ProductsSection />);

    const triggers = screen.getAllByRole("button", { name: /Learn more/ });
    expect(triggers.length).toBeGreaterThan(0);

    fireEvent.click(triggers[0]);

    expect(within(triggers[0].closest("div[class]")!).getByText(/Show less/)).toBeInTheDocument();
  });
});
