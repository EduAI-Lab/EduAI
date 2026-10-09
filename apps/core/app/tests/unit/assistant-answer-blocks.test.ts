// @vitest-environment node
/**
 * #1822: the answer block parser and the client-side href re-validation. Both
 * are pure; the rendering half is covered in help-assistant.test.tsx.
 */
import { describe, expect, it } from "vitest";

import { parseAnswer, parseInline, safeSourceHref } from "~/components/assistant/answer-blocks";

describe("parseAnswer", () => {
  it("splits paragraphs, ordered and unordered lists, and code fences", () => {
    const blocks = parseAnswer(
      [
        "Open the course.",
        "",
        "1. Go to **Courses**.",
        "2. Pick one.",
        "",
        "- a",
        "- b",
        "",
        "```ts",
        "const x = 1;",
        "```",
      ].join("\n"),
    );
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "list", "list", "code"]);
    expect(blocks[1]).toMatchObject({ kind: "list", ordered: true });
    expect(blocks[2]).toMatchObject({ kind: "list", ordered: false });
    expect(blocks[3]).toEqual({ kind: "code", language: "ts", text: "const x = 1;" });
  });

  it("keeps markup as literal text — there is no HTML node kind at all", () => {
    const blocks = parseAnswer('<script>alert(1)</script> and <img src=x onerror="alert(2)">');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      spans: [
        { kind: "text", text: '<script>alert(1)</script> and <img src=x onerror="alert(2)">' },
      ],
    });
  });
});

describe("parseInline", () => {
  it("parses bold and code, leaving unmatched markers as text", () => {
    expect(parseInline("a **b** `c` **d")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", text: "b" },
      { kind: "text", text: " " },
      { kind: "code", text: "c" },
      { kind: "text", text: " **d" },
    ]);
  });
});

describe("safeSourceHref", () => {
  it("accepts same-origin absolute paths", () => {
    expect(safeSourceHref("/help/guide/find-a-course")).toBe("/help/guide/find-a-course");
  });

  it.each([
    "javascript:alert(1)",
    " javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example",
    "/help\u0000javascript:",
    "help/guide/x",
  ])("refuses %j", (url) => {
    expect(safeSourceHref(url)).toBeNull();
  });
});
