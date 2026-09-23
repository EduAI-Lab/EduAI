import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { InstructorViewBanner } from "~/components/rbac/instructor-view-banner";

function renderBanner(exitHref?: string) {
  return render(
    <MemoryRouter>
      <InstructorViewBanner exitHref={exitHref} />
    </MemoryRouter>,
  );
}

describe("InstructorViewBanner (#1843)", () => {
  it("names the view and says the account's admin access is unchanged", () => {
    // The switch is presentation only; the banner must not imply otherwise.
    renderBanner();
    expect(screen.getByText("Instructor view")).toBeInTheDocument();
    expect(screen.getByText(/administrator access is unchanged/i)).toBeInTheDocument();
  });

  it("offers a way back to the admin surface by default", () => {
    renderBanner();
    expect(screen.getByTestId("instructor-view-exit")).toHaveAttribute("href", "/admin");
  });

  it("honours a caller-supplied exit destination", () => {
    renderBanner("/admin/chat");
    expect(screen.getByTestId("instructor-view-exit")).toHaveAttribute("href", "/admin/chat");
  });

  it("does not call the instructor view a preview", () => {
    // Divergence from AI Tutor's StudentPreviewBanner, on purpose: the viewer
    // really is an instructor of record here — the enrollment is why they can
    // be on this page — so "previewing" would misdescribe it.
    renderBanner();
    expect(screen.queryByText(/preview/i)).not.toBeInTheDocument();
  });
});
