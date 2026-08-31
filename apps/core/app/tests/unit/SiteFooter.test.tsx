import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SiteFooter } from "~/components/site-footer";
import { projectInfo } from "~/config/site";

describe("SiteFooter — rendering", () => {
  it("renders the About section", () => {
    render(
      <MemoryRouter>
        <SiteFooter />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "About" })).toBeInTheDocument();
  });

  it("renders the in-page section links", () => {
    render(
      <MemoryRouter>
        <SiteFooter />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "On this page" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Our team" })).toHaveAttribute("href", "#team");
  });

  it("renders the platform links", () => {
    render(
      <MemoryRouter>
        <SiteFooter />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: "Platform" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/auth/register");
    expect(screen.queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  it("does not emit a label for the removed camelCase config key", () => {
    render(
      <MemoryRouter>
        <SiteFooter />
      </MemoryRouter>
    );
    expect(screen.queryByRole("link", { name: /signup/i })).not.toBeInTheDocument();
  });

  it("credits the lab on its own line, above the copyright", () => {
    render(
      <MemoryRouter>
        <SiteFooter />
      </MemoryRouter>,
    );
    expect(screen.getByText(projectInfo.attribution)).toBeInTheDocument();
  });

  it("renders the current year in the copyright line", () => {
    render(
      <MemoryRouter>
        <SiteFooter />
      </MemoryRouter>,
    );
    const year = new Date().getFullYear().toString();
    expect(screen.getByText(new RegExp(year))).toBeInTheDocument();
  });
});
