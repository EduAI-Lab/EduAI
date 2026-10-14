import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HelpHint, type HelpHintContent } from "../help-hint";

const CONTENT: HelpHintContent = {
  title: "Publishing",
  summary: "Controls whether learners can access this content.",
  details: "Published content is available according to the course visibility rules.",
  href: "/help#publishing",
};

const trigger = () => screen.getByRole("button", { name: "About Publishing" });

function hover(el: HTMLElement) {
  fireEvent.pointerMove(el, { pointerType: "mouse" });
}

describe("HelpHint", () => {
  it("renders a real, named button with popover semantics and nothing open", () => {
    render(<HelpHint {...CONTENT} />);
    const button = trigger();
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows only the summary on hover", async () => {
    render(<HelpHint {...CONTENT} />);
    hover(trigger());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(CONTENT.summary);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the summary on keyboard focus and describes the trigger with it", async () => {
    render(<HelpHint {...CONTENT} />);
    act(() => trigger().focus());
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(CONTENT.summary);
    expect(trigger()).toHaveAttribute("aria-describedby", tooltip.id);
  });

  it("opens the details, title and guide link on click, and hides the summary", () => {
    render(<HelpHint {...CONTENT} />);
    fireEvent.click(trigger());

    const dialog = screen.getByRole("dialog", { name: "Publishing" });
    expect(dialog).toHaveTextContent(CONTENT.details);
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /read more in the help guide/i })).toHaveAttribute(
      "href",
      "/help#publishing",
    );
  });

  it.each(["Enter", " "])("opens on the %j key, as a native button does", (key) => {
    render(<HelpHint {...CONTENT} />);
    const button = trigger();
    act(() => button.focus());
    // Native buttons turn Enter/Space into a click; happy-dom does not, so assert
    // the key isn't swallowed and then dispatch the click the browser would.
    expect(fireEvent.keyDown(button, { key })).toBe(true);
    fireEvent.click(button);
    expect(screen.getByRole("dialog", { name: "Publishing" })).toBeInTheDocument();
  });

  it("opens on a touch tap without flashing the hover summary", () => {
    render(<HelpHint {...CONTENT} />);
    const button = trigger();
    fireEvent.pointerMove(button, { pointerType: "touch" });
    fireEvent.pointerDown(button, { pointerType: "touch" });
    fireEvent.click(button);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger without reopening the summary", async () => {
    render(<HelpHint {...CONTENT} />);
    fireEvent.click(trigger());
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger()).toHaveFocus();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // A later, deliberate hover still shows the summary.
    hover(trigger());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(CONTENT.summary);
  });

  it("toggles closed when the trigger is clicked again", async () => {
    render(<HelpHint {...CONTENT} />);
    fireEvent.click(trigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes when the guide link is followed and passes the href to a router link", async () => {
    const RouterLink = React.forwardRef<HTMLAnchorElement, { to: string; href?: string }>(
      ({ to, href: _href, ...rest }, ref) => <a ref={ref} href={to} data-router-link {...rest} />,
    );
    RouterLink.displayName = "RouterLink";
    render(<HelpHint {...CONTENT} LinkComponent={RouterLink} linkLabel="Open guide" />);
    fireEvent.click(trigger());

    const link = screen.getByRole("link", { name: "Open guide" });
    expect(link).toHaveAttribute("data-router-link");
    expect(link).toHaveAttribute("href", "/help#publishing");
    fireEvent.click(link);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
