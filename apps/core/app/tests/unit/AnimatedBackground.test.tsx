import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AnimatedBackground } from "~/components/animated-background";

describe("AnimatedBackground — rendering", () => {
  it("renders a canvas element without throwing", () => {
    const { container } = render(<AnimatedBackground />);
    expect(container.querySelector("canvas")).toBeInTheDocument();
  });
});
