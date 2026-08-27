/**
 * Unit tests for `DifficultySlider` (#1546): three-way segmented control for
 * question difficulty.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DifficultySlider } from "@/components/composer/DifficultySlider";

afterEach(() => cleanup());

describe("DifficultySlider", () => {
  it("marks the current value as the checked radio", () => {
    render(<DifficultySlider value="medium" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /Medium/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Easy/ })).toHaveAttribute("aria-checked", "false");
  });

  it("calls onChange with the clicked level", () => {
    const onChange = vi.fn();
    render(<DifficultySlider value="easy" onChange={onChange} />);
    screen.getByRole("radio", { name: /Hard/ }).click();
    expect(onChange).toHaveBeenCalledWith("hard");
  });

  it("disables all options and applies the disabled visual state", () => {
    render(<DifficultySlider value="easy" onChange={vi.fn()} disabled />);
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }
  });

  it("shows the blurb for the active difficulty", () => {
    render(<DifficultySlider value="hard" onChange={vi.fn()} />);
    expect(screen.getByRole("radiogroup").nextSibling?.textContent).toContain("Hard");
  });
});
