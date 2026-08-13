/**
 * Unit tests for the course card "customize appearance" popover — a Radix
 * popover holding a nickname input, preset colour swatches, a free-form
 * hex/oklch input, and Apply/Cancel actions that call `onApply` with the
 * merged preference (or null to clear it) rather than mutating anything
 * itself. `onApply`/close is asserted on rather than any persistence, per
 * the prop-driven "dumb view" convention.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CourseCardCustomizePopover } from "~/components/courses/course-card-customize-popover";
import { COURSE_COLOR_PRESETS } from "@eduai/ui";
import type { CourseCardPreference } from "~/lib/courses/course-card-preferences";

function renderPopover(
  overrides: Partial<React.ComponentProps<typeof CourseCardCustomizePopover>> = {},
) {
  const onApply = vi.fn();
  render(
    <CourseCardCustomizePopover
      courseName="Intro to CS"
      courseCode="CS101"
      onApply={onApply}
      {...overrides}
    />,
  );
  return { onApply };
}

function openPopover() {
  fireEvent.click(screen.getByRole("button", { name: "Customize Intro to CS" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CourseCardCustomizePopover", () => {
  it("is closed by default", () => {
    renderPopover();
    expect(screen.queryByText("Course appearance")).not.toBeInTheDocument();
  });

  it("opens on trigger click and shows an empty nickname field with no preference", async () => {
    renderPopover();
    openPopover();

    await waitFor(() => expect(screen.getByText("Course appearance")).toBeInTheDocument());
    expect(screen.getByLabelText(/Nickname/)).toHaveValue("");
  });

  it("seeds the draft from an existing preference when opened", async () => {
    const preference: CourseCardPreference = { color: "#1a76b8", nickname: "My CS" };
    renderPopover({ preference });
    openPopover();

    await waitFor(() => expect(screen.getByLabelText(/Nickname/)).toHaveValue("My CS"));
    expect(screen.getByLabelText("Custom colour")).toHaveValue("#1a76b8");
    const swatch = screen.getByRole("button", { name: `Colour ${COURSE_COLOR_PRESETS[0]}` });
    // Not necessarily selected unless it matches — just confirm swatches render.
    expect(swatch).toBeInTheDocument();
  });

  it("closes without calling onApply when Cancel is clicked", async () => {
    const { onApply } = renderPopover();
    openPopover();
    await waitFor(() => expect(screen.getByText("Course appearance")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Nickname/), { target: { value: "Ignored" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByText("Course appearance")).not.toBeInTheDocument(),
    );
    expect(onApply).not.toHaveBeenCalled();
  });

  it("closes via the X button without applying", async () => {
    const { onApply } = renderPopover();
    openPopover();
    await waitFor(() => expect(screen.getByText("Course appearance")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(screen.queryByText("Course appearance")).not.toBeInTheDocument(),
    );
    expect(onApply).not.toHaveBeenCalled();
  });

  it("applies null when neither a nickname nor a colour is set", async () => {
    const { onApply } = renderPopover();
    openPopover();
    await waitFor(() => expect(screen.getByText("Course appearance")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledWith(null);
  });

  it("applies a typed nickname", async () => {
    const { onApply } = renderPopover();
    openPopover();
    await waitFor(() => expect(screen.getByText("Course appearance")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Nickname/), { target: { value: "  My Course  " } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledWith({ nickname: "My Course" });
  });

  it("selects a preset swatch and applies its colour", async () => {
    const { onApply } = renderPopover();
    openPopover();
    await waitFor(() => expect(screen.getByText("Course appearance")).toBeInTheDocument());

    const preset = COURSE_COLOR_PRESETS[2];
    fireEvent.click(screen.getByRole("button", { name: `Colour ${preset}` }));
    expect(screen.getByRole("button", { name: `Colour ${preset}` })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledWith({ color: preset });
  });

  it("applies a valid typed hex colour from the free-form input", async () => {
    const { onApply } = renderPopover();
    openPopover();
    await waitFor(() => expect(screen.getByText("Course appearance")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Custom colour"), {
      target: { value: "#1a76b8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledWith({ color: "#1a76b8" });
  });

  it("ignores an invalid free-form colour and applies without one", async () => {
    const { onApply } = renderPopover();
    openPopover();
    await waitFor(() => expect(screen.getByText("Course appearance")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Custom colour"), {
      target: { value: "not-a-colour" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledWith(null);
  });

  it("applies both a nickname and a colour together", async () => {
    const { onApply } = renderPopover();
    openPopover();
    await waitFor(() => expect(screen.getByText("Course appearance")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Nickname/), { target: { value: "Nick" } });
    fireEvent.change(screen.getByLabelText("Custom colour"), {
      target: { value: "#ffaa00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApply).toHaveBeenCalledWith({ color: "#ffaa00", nickname: "Nick" });
  });

  it("stops trigger click propagation so it doesn't bubble to a wrapping card link", async () => {
    const onCardClick = vi.fn();
    render(
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
      <div onClick={onCardClick}>
        <CourseCardCustomizePopover courseName="Intro to CS" onApply={vi.fn()} />
      </div>,
    );

    openPopover();

    expect(onCardClick).not.toHaveBeenCalled();
  });
});
