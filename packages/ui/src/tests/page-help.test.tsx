import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PageHelpButton, resolvePageHelp, type PageHelpContent } from "../page-help";

const CONTENT: PageHelpContent = {
  title: "Course materials",
  summary: "Upload files so the chatbot can answer from them.",
  tips: ["Ready means the file is live for chat."],
  helpHref: "/help#materials",
};

describe("resolvePageHelp", () => {
  const fallback: PageHelpContent = { title: "Fallback", summary: "fallback" };
  const routes = [
    { match: "/dashboard", content: { title: "Dashboard", summary: "d" } },
    { match: /^\/courses\/[^/]+$/, content: { title: "Course", summary: "c" } },
    { match: /^\/admin\//, content: { title: "Admin", summary: "a" } },
  ];

  it("matches exact strings and patterns in order", () => {
    expect(resolvePageHelp("/dashboard", routes, fallback).title).toBe("Dashboard");
    expect(resolvePageHelp("/courses/abc", routes, fallback).title).toBe("Course");
    expect(resolvePageHelp("/admin/users", routes, fallback).title).toBe("Admin");
  });

  it("does not treat a string match as a prefix", () => {
    expect(resolvePageHelp("/dashboard/extra", routes, fallback).title).toBe("Fallback");
  });

  it("returns the fallback for an unknown route", () => {
    expect(resolvePageHelp("/nowhere", routes, fallback)).toBe(fallback);
  });
});

describe("PageHelpButton", () => {
  it("renders an accessible trigger and keeps the modal closed initially", () => {
    render(<PageHelpButton content={CONTENT} />);
    expect(screen.getByRole("button", { name: "Help for this page" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a modal with the page's contextual help and a deep link to the guide", () => {
    render(<PageHelpButton content={CONTENT} />);
    fireEvent.click(screen.getByRole("button", { name: "Help for this page" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Course materials");
    expect(dialog).toHaveTextContent("Upload files so the chatbot can answer from them.");
    expect(dialog).toHaveTextContent("Ready means the file is live for chat.");
    expect(screen.getByRole("link", { name: /open full help guide/i })).toHaveAttribute(
      "href",
      "/help#materials",
    );
  });

  it("falls back to the button-level guide link when the content has none", () => {
    render(<PageHelpButton content={{ title: "Settings", summary: "s" }} helpHref="/guide" />);
    fireEvent.click(screen.getByRole("button", { name: "Help for this page" }));
    expect(screen.getByRole("link", { name: /open full help guide/i })).toHaveAttribute(
      "href",
      "/guide",
    );
  });

  it("hides the tour option when no tour is on offer", () => {
    render(<PageHelpButton content={CONTENT} tour={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Help for this page" }));
    expect(screen.queryByRole("button", { name: /take a tour/i })).not.toBeInTheDocument();
  });

  it("closes the modal and then starts the tour", async () => {
    const onStart = vi.fn();
    render(
      <PageHelpButton
        content={CONTENT}
        tour={{ onStart, label: "Take the tour", description: "A quick walkthrough." }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Help for this page" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("A quick walkthrough.");

    fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));

    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("passes both `to` and `href` to a custom LinkComponent", () => {
    const Link = vi.fn(({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
      <a data-to={to} {...rest}>
        {children}
      </a>
    ));
    render(<PageHelpButton content={CONTENT} LinkComponent={Link} />);
    fireEvent.click(screen.getByRole("button", { name: "Help for this page" }));
    const link = screen.getByRole("link", { name: /open full help guide/i });
    expect(link).toHaveAttribute("data-to", "/help#materials");
    expect(link).toHaveAttribute("href", "/help#materials");
  });

  it("draws the attention indicator only when asked", () => {
    const { container, rerender } = render(<PageHelpButton content={CONTENT} />);
    expect(container.querySelector(".animate-ping")).toBeNull();
    rerender(<PageHelpButton content={CONTENT} showIndicator />);
    expect(container.querySelector(".animate-ping")).not.toBeNull();
  });
});
