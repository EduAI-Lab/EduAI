import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VariantBadge, variantLabel } from "../variant-badge";

describe("variantLabel", () => {
  it("labels originals when referenceId is null", () => {
    expect(variantLabel({ referenceId: null })).toBe("Original");
  });

  it("labels a variant without an ordinal", () => {
    expect(variantLabel({ referenceId: 4 })).toBe("Variant of #4");
  });

  it("labels a numbered variant", () => {
    expect(variantLabel({ referenceId: 4, variantNumber: 2 })).toBe("Variant 2 of #4");
  });
});

describe("VariantBadge", () => {
  it("renders the original badge for non-variants", () => {
    render(<VariantBadge referenceId={null} />);
    expect(screen.getByText("Original")).toBeInTheDocument();
  });

  it("renders the variant identity for variants", () => {
    render(<VariantBadge referenceId={4} variantNumber={2} />);
    expect(screen.getByText("Variant 2 of #4")).toBeInTheDocument();
  });

  it("renders nothing for originals when hideOriginal is set", () => {
    const { container } = render(<VariantBadge referenceId={null} hideOriginal />);
    expect(container).toBeEmptyDOMElement();
  });
});
