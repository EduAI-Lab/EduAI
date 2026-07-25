import { describe, expect, it } from "vitest"

import { probeTitleCase } from "../utils"

describe("probeTitleCase (temporary #1192 probe)", () => {
  it("title-cases a non-empty value", () => {
    expect(probeTitleCase("hELLO")).toBe("Hello")
  })
  // The empty-input branch is intentionally NOT exercised.
})
