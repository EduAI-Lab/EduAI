/**
 * @file The shared 404 page Core, AI Tutor and Question Maker all render. Both
 * shapes are asserted because the difference is the point of the prop: the
 * standalone form centres itself on a bare page, the in-shell form must not,
 * or it would push the sidebar and header off-screen.
 */
import { render, screen } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it } from "vitest";

import { NotFoundState } from "../not-found-state";

const TITLE = "404 — Page not found";

describe("NotFoundState", () => {
  it("names the status and offers a way back to the dashboard", () => {
    render(<NotFoundState />);

    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("says nothing about whether the page exists", () => {
    render(<NotFoundState />);

    // One sentence covers "no such page" and "not yours to open" alike.
    expect(screen.getByText(/doesn't exist, or you don't have access to it/i)).toBeInTheDocument();
  });

  it("centres itself on a bare page when standalone", () => {
    render(<NotFoundState standalone />);

    expect(screen.getByRole("main").className).toContain("min-h-dvh");
  });

  it("renders without the bare-page wrapper by default", () => {
    render(<NotFoundState />);

    expect(screen.queryByRole("main")).toBeNull();
  });

  it("gives the default <a> an href and no stray router `to`", () => {
    render(<NotFoundState homeHref="/home" />);

    const link = screen.getByRole("link", { name: /go to dashboard/i });
    expect(link).toHaveAttribute("href", "/home");
    expect(link).not.toHaveAttribute("to");
  });

  it("routes the way back through the app's own link component, passing only `to`", () => {
    const received: object[] = [];
    function RouterLink(props: { to: string; children: React.ReactNode }) {
      received.push(props);
      const { to, children, ...rest } = props;
      return (
        <a data-router-link={to} href={to} {...rest}>
          {children}
        </a>
      );
    }

    render(<NotFoundState LinkComponent={RouterLink} homeHref="/home" />);

    const link = screen.getByRole("link", { name: /go to dashboard/i });
    expect(link).toHaveAttribute("data-router-link", "/home");
    expect(received.every((props) => !("href" in props))).toBe(true);
  });
});
