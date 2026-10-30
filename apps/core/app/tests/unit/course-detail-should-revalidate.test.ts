import { describe, expect, it } from "vitest";
import type { ShouldRevalidateFunctionArgs } from "react-router";

import { shouldRevalidate } from "~/routes/courses.$courseId";

function args(
  current: string,
  next: string,
  extra: Partial<ShouldRevalidateFunctionArgs> = {},
): ShouldRevalidateFunctionArgs {
  return {
    currentUrl: new URL(current, "http://localhost"),
    nextUrl: new URL(next, "http://localhost"),
    currentParams: {},
    nextParams: {},
    defaultShouldRevalidate: true,
    ...extra,
  } as ShouldRevalidateFunctionArgs;
}

describe("course page shouldRevalidate", () => {
  it("skips the loader when only the course menu section (?tab=) changes", () => {
    expect(shouldRevalidate(args("/courses/c1", "/courses/c1?tab=materials"))).toBe(false);
    expect(shouldRevalidate(args("/courses/c1?tab=materials", "/courses/c1?tab=topics"))).toBe(
      false,
    );
  });

  it("keeps an explicit revalidation of the same URL", () => {
    expect(shouldRevalidate(args("/courses/c1?tab=topics", "/courses/c1?tab=topics"))).toBe(true);
  });

  it("keeps the default for another course, another param, or a form submission", () => {
    expect(shouldRevalidate(args("/courses/c1", "/courses/c2?tab=materials"))).toBe(true);
    expect(shouldRevalidate(args("/courses/c1", "/courses/c1?tour=1"))).toBe(true);
    expect(
      shouldRevalidate(args("/courses/c1", "/courses/c1?tab=materials", { formMethod: "POST" })),
    ).toBe(true);
  });
});
