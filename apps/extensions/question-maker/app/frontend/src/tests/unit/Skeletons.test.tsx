/**
 * Unit tests for the shared skeleton presets (#1546): render counts and the
 * responsive column-class branches for `CardGridSkeleton`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  CardGridSkeleton,
  CardSkeleton,
  ListSkeleton,
  StatRowSkeleton,
} from "@/components/shared/Skeletons";

afterEach(() => cleanup());

describe("CardSkeleton", () => {
  it("renders with a custom className", () => {
    const { container } = render(<CardSkeleton className="custom" />);
    expect(container.firstChild).toHaveClass("custom");
  });
});

describe("CardGridSkeleton", () => {
  it("renders the default count of card skeletons", () => {
    const { container } = render(<CardGridSkeleton />);
    expect(container.querySelectorAll(":scope > div > div")).toHaveLength(6);
  });

  it("renders a custom count", () => {
    const { container } = render(<CardGridSkeleton count={3} />);
    expect(container.firstChild?.childNodes).toHaveLength(3);
  });

  it.each([
    [1, "grid-cols-1"],
    [2, "lg:grid-cols-2"],
    [3, "xl:grid-cols-3"],
  ] as const)("applies the columns=%s class", (columns, expectedClass) => {
    const { container } = render(<CardGridSkeleton columns={columns} count={1} />);
    expect(container.firstChild).toHaveClass(expectedClass);
  });
});

describe("ListSkeleton", () => {
  it("renders the default count of rows", () => {
    const { container } = render(<ListSkeleton />);
    expect(container.firstChild?.childNodes).toHaveLength(5);
  });

  it("renders a custom count of rows", () => {
    const { container } = render(<ListSkeleton count={2} />);
    expect(container.firstChild?.childNodes).toHaveLength(2);
  });
});

describe("StatRowSkeleton", () => {
  it("renders the default count of stat tiles", () => {
    const { container } = render(<StatRowSkeleton />);
    expect(container.firstChild?.childNodes).toHaveLength(4);
  });

  it("renders a custom count of stat tiles", () => {
    const { container } = render(<StatRowSkeleton count={2} />);
    expect(container.firstChild?.childNodes).toHaveLength(2);
  });
});
