import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SuggestTopicsBar } from "~/components/courses/suggest-topics-bar";

describe("SuggestTopicsBar (#1966)", () => {
  it("says how many files have no topic and starts a run", () => {
    const onSuggest = vi.fn(async () => {});
    render(<SuggestTopicsBar unfiledMaterials={3} busy={false} onSuggest={onSuggest} />);

    expect(screen.getByText(/3 files have no topic yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /suggest topics/i }));
    expect(onSuggest).toHaveBeenCalledTimes(1);
  });

  it("is disabled while a topic job runs", () => {
    render(<SuggestTopicsBar unfiledMaterials={0} busy onSuggest={vi.fn()} />);
    expect(screen.getByRole("button", { name: /working/i })).toBeDisabled();
  });

  it("explains a course with no materials", async () => {
    const onSuggest = vi.fn(async () => {
      throw new Error('{"error":"NO_ANALYZABLE_MATERIALS"}');
    });
    render(<SuggestTopicsBar unfiledMaterials={0} busy={false} onSuggest={onSuggest} />);

    fireEvent.click(screen.getByRole("button", { name: /suggest topics/i }));

    expect(await screen.findByText(/Upload some course materials first/)).toBeInTheDocument();
  });
});
