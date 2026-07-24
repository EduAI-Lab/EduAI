import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DetailPageScaffold } from "../detail-page-scaffold";

describe("DetailPageScaffold", () => {
  it("renders beforeHero, hero, and children in order", () => {
    const { container } = render(
      <DetailPageScaffold
        beforeHero={<div data-testid="before-hero">Before</div>}
        hero={<div data-testid="hero">Hero</div>}
      >
        <div data-testid="children">Children</div>
      </DetailPageScaffold>,
    );
    const root = container.firstElementChild as HTMLElement;
    const order = Array.from(root.children).map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual(["before-hero", "hero", "children"]);
  });

  it("renders hero and children even when beforeHero is omitted", () => {
    render(
      <DetailPageScaffold hero={<div data-testid="hero">Hero</div>}>
        <div data-testid="children">Children</div>
      </DetailPageScaffold>,
    );
    expect(screen.getByTestId("hero")).toBeInTheDocument();
    expect(screen.getByTestId("children")).toBeInTheDocument();
  });

  it("defaults to the 'none' padding class string", () => {
    const { container } = render(
      <DetailPageScaffold hero={<div>Hero</div>}>
        <div>Children</div>
      </DetailPageScaffold>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe("flex flex-col gap-6");
  });

  it("applies the 'qm' padding class string", () => {
    const { container } = render(
      <DetailPageScaffold hero={<div>Hero</div>} padding="qm">
        <div>Children</div>
      </DetailPageScaffold>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe("flex flex-1 flex-col gap-6 px-4 py-4 md:py-6 lg:px-6");
  });

  it("applies the 'app' padding class string", () => {
    const { container } = render(
      <DetailPageScaffold hero={<div>Hero</div>} padding="app">
        <div>Children</div>
      </DetailPageScaffold>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe("flex flex-col gap-6 px-4 pt-6 pb-8 lg:px-6");
  });

  it("passes style through to the outer wrapper", () => {
    const { container } = render(
      <DetailPageScaffold hero={<div>Hero</div>} style={{ ["--accent" as string]: "red" }}>
        <div>Children</div>
      </DetailPageScaffold>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue("--accent")).toBe("red");
  });
});
