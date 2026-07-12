import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from "../ui/button-group";

describe("ButtonGroup", () => {
  it("renders as a group with the button-group slot and horizontal classes by default", () => {
    render(
      <ButtonGroup data-testid="bg">
        <button type="button">One</button>
        <button type="button">Two</button>
      </ButtonGroup>,
    );
    const group = screen.getByTestId("bg");
    expect(group).toHaveAttribute("role", "group");
    expect(group).toHaveAttribute("data-slot", "button-group");
    // orientation prop is unset, so the data attribute is omitted entirely...
    expect(group).not.toHaveAttribute("data-orientation");
    // ...but the cva defaultVariants still resolves to horizontal classes.
    expect(group.className).toContain("rounded-l-none");
  });

  it("applies vertical orientation classes and the data attribute when set", () => {
    render(<ButtonGroup orientation="vertical" data-testid="bg" />);
    const group = screen.getByTestId("bg");
    expect(group).toHaveAttribute("data-orientation", "vertical");
    expect(group.className).toContain("flex-col");
  });
});

describe("ButtonGroupText", () => {
  it("renders children in a div by default", () => {
    render(<ButtonGroupText>Label</ButtonGroupText>);
    const el = screen.getByText("Label");
    expect(el.tagName).toBe("DIV");
    expect(el.className).toContain("bg-muted");
  });

  it("renders the child element directly when asChild is set", () => {
    render(
      <ButtonGroupText asChild>
        <a href="#anchor">Link</a>
      </ButtonGroupText>,
    );
    const el = screen.getByText("Link");
    expect(el.tagName).toBe("A");
    expect(el.className).toContain("bg-muted");
  });
});

describe("ButtonGroupSeparator", () => {
  it("renders with the button-group-separator slot", () => {
    const { container } = render(<ButtonGroupSeparator />);
    const separator = container.querySelector('[data-slot="button-group-separator"]');
    expect(separator).not.toBeNull();
    expect(separator).toHaveAttribute("data-orientation", "vertical");
  });
});
