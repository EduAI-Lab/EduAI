/**
 * @file Split a guide into its `##` / `###` sections (#1819). Pure.
 *
 * A section's body runs from its heading to the next heading of level 2 or 3, so
 * a `##` that only introduces subsections has an empty body and is not a page on
 * its own. Fenced code blocks are respected — a `#` line inside a fence is code,
 * not a heading. Horizontal rules (`---`) are dropped as layout noise.
 */

export type MarkdownSection = {
  heading: string;
  level: 2 | 3;
  /** Body text with surrounding blank lines and rule lines removed. */
  body: string;
};

const HEADING = /^(#{2,3})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

export function splitMarkdownSections(markdown: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let current: { heading: string; level: 2 | 3; lines: string[] } | null = null;
  let inFence = false;

  const flush = () => {
    if (!current) return;
    const body = current.lines
      .filter((line) => !RULE.test(line))
      .join("\n")
      .trim();
    sections.push({ heading: current.heading, level: current.level, body });
  };

  for (const line of markdown.split(/\r?\n/)) {
    if (FENCE.test(line)) inFence = !inFence;
    const match = inFence ? null : HEADING.exec(line);
    if (match) {
      flush();
      current = { heading: match[2], level: match[1] === "##" ? 2 : 3, lines: [] };
      continue;
    }
    // A level-1 title or level-4+ heading stays part of the surrounding text;
    // anything before the first `##` is the guide's own preamble and is skipped.
    current?.lines.push(line);
  }
  flush();
  return sections;
}

/** Sections that have body text of their own — the only ones that can be pages. */
export function sectionsWithBody(markdown: string): MarkdownSection[] {
  return splitMarkdownSections(markdown).filter((section) => section.body.length > 0);
}
