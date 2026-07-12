import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "../ui/input-group";

describe("InputGroup", () => {
  it("renders a group wrapper containing an input with the input-group-control slot", () => {
    render(
      <InputGroup data-testid="wrapper">
        <InputGroupInput placeholder="Search" />
      </InputGroup>,
    );
    const wrapper = screen.getByTestId("wrapper");
    expect(wrapper).toHaveAttribute("role", "group");
    expect(wrapper).toHaveAttribute("data-slot", "input-group");
    expect(screen.getByPlaceholderText("Search")).toHaveAttribute(
      "data-slot",
      "input-group-control",
    );
  });
});

describe("InputGroupAddon", () => {
  it("defaults to inline-start alignment", () => {
    render(<InputGroupAddon>Addon</InputGroupAddon>);
    expect(screen.getByText("Addon")).toHaveAttribute("data-align", "inline-start");
  });

  it("accepts a custom alignment", () => {
    render(<InputGroupAddon align="block-end">Addon</InputGroupAddon>);
    expect(screen.getByText("Addon")).toHaveAttribute("data-align", "block-end");
  });

  it("focuses the sibling input when clicked outside of a nested button", () => {
    render(
      <InputGroup>
        <InputGroupAddon data-testid="addon">
          <InputGroupText>$</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput placeholder="Amount" />
      </InputGroup>,
    );
    fireEvent.click(screen.getByTestId("addon"));
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Amount"));
  });
});

describe("InputGroupButton", () => {
  it("renders a type=button, xs-size button by default", () => {
    render(<InputGroupButton>Go</InputGroupButton>);
    const button = screen.getByRole("button", { name: "Go" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("data-size", "xs");
  });

  it("honors a custom size", () => {
    render(<InputGroupButton size="sm">Go</InputGroupButton>);
    expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute("data-size", "sm");
  });
});

describe("InputGroupText", () => {
  it("renders inline text in a span", () => {
    render(<InputGroupText>Hint</InputGroupText>);
    const el = screen.getByText("Hint");
    expect(el.tagName).toBe("SPAN");
  });
});

describe("InputGroupTextarea", () => {
  it("renders a textarea with the input-group-control slot", () => {
    render(<InputGroupTextarea placeholder="Message" />);
    expect(screen.getByPlaceholderText("Message")).toHaveAttribute(
      "data-slot",
      "input-group-control",
    );
  });
});
