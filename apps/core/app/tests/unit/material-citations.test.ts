import { describe, it, expect } from "vitest";

import { stripModelSourceCitations } from "~/lib/chat/material-citations";

describe("stripModelSourceCitations", () => {
  it("drops the invented source line from the #1936 answer", () => {
    const text = [
      "Based on the course materials provided:",
      "**Due Date: Tuesday, December 9.**",
      "",
      "*(Source: ZZ-TEST-DATA301-L15-Data-Cleaning)*",
    ].join("\n");
    expect(stripModelSourceCitations(text)).toBe(
      ["Based on the course materials provided:", "**Due Date: Tuesday, December 9.**"].join("\n"),
    );
  });

  it("drops inline parenthetical citations but keeps the sentence", () => {
    expect(stripModelSourceCitations("Lab 14 is due Nov 20 (Source: L14 Data Cleaning).")).toBe(
      "Lab 14 is due Nov 20.",
    );
    expect(stripModelSourceCitations("iClicker is 5% *(Sources: 301_1_Intro)*")).toBe(
      "iClicker is 5%",
    );
  });

  it("drops Source/Sources lines and a Sources block with its list", () => {
    const text = [
      "Tidy data has one observation per row.",
      "",
      "**Source**: 301_1_Intro",
      "",
      "**Sources**",
      "- L14 Data Cleaning, slide 3",
      "- 301_1_Intro",
      "",
      "Sources: L14",
    ].join("\n");
    expect(stripModelSourceCitations(text)).toBe("Tidy data has one observation per row.");
  });

  it("keeps citations that point at a URL (web tools)", () => {
    const text =
      "Python 3.13 is out (Source: https://python.org/downloads).\n\nSources: https://a.example";
    expect(stripModelSourceCitations(text)).toBe(text);
  });

  it("keeps a markdown link citation whole (PR #1946 review)", () => {
    const text = "See the docs (Source: [docs](https://docs.python.org/3/)).";
    expect(stripModelSourceCitations(text)).toBe(text);
  });

  it("never touches code (PR #1946 review)", () => {
    const fenced = [
      "Copy it like this:",
      "```python",
      "def copy_file(source: str, dest: str) -> None:",
      "    pass",
      "```",
      "```yaml",
      "source: data/raw.csv",
      "sources:",
      "  - a.csv",
      "```",
    ].join("\n");
    expect(stripModelSourceCitations(fenced)).toBe(fenced);

    const unfenced = "Call copy_file(source: str, dest: str) or set `(Source: x)` in YAML.";
    expect(stripModelSourceCitations(unfenced)).toBe(unfenced);
    expect(stripModelSourceCitations("source: data/raw.csv\nsources:\n  - a.csv")).toBe(
      "source: data/raw.csv\nsources:\n  - a.csv",
    );
  });

  it("leaves ordinary prose about sources alone", () => {
    const text = "Primary sources are first-hand accounts. The source code is on GitHub.";
    expect(stripModelSourceCitations(text)).toBe(text);
  });
});
