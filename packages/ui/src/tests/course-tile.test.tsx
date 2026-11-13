import { render, screen } from "@testing-library/react";
import { IconFiles, IconRobot } from "@tabler/icons-react";
import { describe, expect, it } from "vitest";

import { CourseTile, type CourseTileLinkComponent } from "../course-tile";

/** Stands in for a router link: renders `to` as the href, marked so tests can tell. */
const RouterLink: CourseTileLinkComponent = ({ to, className, children }) => (
  <a href={to} className={className} data-router-link="">
    {children}
  </a>
);

const BASE = {
  code: "COSC 111",
  title: "Programming I",
  term: "W1",
  year: 2026,
  accent: "oklch(0.56 0.20 255)",
  href: "/courses/c1",
};

describe("CourseTile", () => {
  it("titles the card 'code · name' and links the title to the course", () => {
    render(<CourseTile {...BASE} links={[]} />);
    const title = screen.getByRole("link", { name: "COSC 111 · Programming I" });
    expect(title).toHaveAttribute("href", "/courses/c1");
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("COSC 111 · Programming I");
  });

  it("falls back to the name alone when the course has no code", () => {
    render(<CourseTile {...BASE} code="" links={[]} />);
    expect(screen.getByRole("link", { name: "Programming I" })).toBeInTheDocument();
  });

  it("shows the publish badge only when a publish state is given", () => {
    const { rerender } = render(<CourseTile {...BASE} links={[]} />);
    expect(screen.queryByText("Unpublished")).not.toBeInTheDocument();
    rerender(<CourseTile {...BASE} links={[]} publishState={false} />);
    expect(screen.getByText("Unpublished")).toBeInTheDocument();
  });

  it("draws the links in a labelled nav, in-app through the router and other apps as plain links", () => {
    render(
      <CourseTile
        {...BASE}
        LinkComponent={RouterLink}
        links={[
          {
            key: "materials",
            label: "Materials",
            icon: IconFiles,
            href: "/courses/c1?tab=materials",
          },
          {
            key: "tutor",
            label: "AI Tutor",
            icon: IconFiles,
            href: "https://tutor.example/",
            external: true,
          },
        ]}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "COSC 111 sections" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Materials" })).toHaveAttribute("data-router-link");
    expect(screen.getByRole("link", { name: "AI Tutor" })).not.toHaveAttribute("data-router-link");
  });

  it("renders a link with no href as a disabled control", () => {
    render(
      <CourseTile
        {...BASE}
        links={[
          {
            key: "assistant",
            label: "Assistant",
            icon: IconRobot,
            disabledReason: "Publish this course to open the course assistant",
          },
        ]}
      />,
    );
    expect(screen.queryByRole("link", { name: "Assistant" })).not.toBeInTheDocument();
    expect(screen.getByText("Assistant").parentElement).toHaveAttribute("aria-disabled", "true");
  });

  it("omits the links row when there are no links", () => {
    render(<CourseTile {...BASE} links={[]} />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });
});
