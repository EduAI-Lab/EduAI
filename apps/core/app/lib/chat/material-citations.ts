/**
 * Model-written course-material citations (#1936).
 *
 * A chat model writes "(Source: …)" from memory of the excerpt headers, and a
 * small one gets the name wrong — "L14" came back as "L15", a file that doesn't
 * exist. The materials a turn actually retrieved are listed under the message
 * from server metadata instead, so on those turns the model's own citations
 * are removed from what the student sees. Citations that carry a URL are left
 * alone: those come from web tools, and the link itself is checkable.
 *
 * Code is never touched: fenced blocks and inline code spans pass through, and
 * a parenthesis that follows an identifier (`copy_file(source: str)`) is a
 * call, not a citation. Line-level citations must start with a capital
 * "Source", so a YAML `source:` key survives even outside a fence.
 */

const URL_RE = /https?:\/\/|www\./i;

/**
 * "(Source: X)", "*(Sources: X)*", "[Source: X]", "(Source: [docs](url))" —
 * one level of nested parentheses so a markdown link inside stays whole.
 */
const INLINE_CITATION_RE =
  /\s*[*_]{0,2}(?<![\w)\]])[([]\s*[*_]{0,2}sources?[*_]{0,2}\s*:(?:[^()[\]\n]|\([^()\n]*\)|\[[^[\]\n]*\])*[)\]][*_]{0,2}/gi;

/** A line that is only a citation: "Source: X", "**Sources**: X", "- **Source:** X". */
const CITATION_LINE_RE = /^\s*(?:[-*>]\s+)?[*_]{0,2}S(?:ources?|OURCES?)[*_]{0,2}\s*:/;

/** A bare "Sources" heading whose list follows on the next lines. */
const SOURCES_HEADING_RE = /^\s*(?:#{1,6}\s*)?[*_]{0,2}S(?:ources?|OURCES?)[*_]{0,2}\s*:?\s*$/;

const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;
const FENCE_RE = /^\s*(```|~~~)/;
const INLINE_CODE_RE = /(`+)[^`]*?\1/g;

/** Strip inline citations from prose, leaving inline code spans untouched. */
function stripInlineCitations(line: string): string {
  let result = "";
  let last = 0;
  for (const code of line.matchAll(INLINE_CODE_RE)) {
    const start = code.index ?? 0;
    result += stripProseCitations(line.slice(last, start)) + code[0];
    last = start + code[0].length;
  }
  return result + stripProseCitations(line.slice(last));
}

function stripProseCitations(prose: string): string {
  return prose.replace(INLINE_CITATION_RE, (citation) => (URL_RE.test(citation) ? citation : ""));
}

/** Remove model-written material citations, keeping URL citations, code, and ordinary prose. */
export function stripModelSourceCitations(text: string): string {
  if (!/sources?/i.test(text)) return text;

  const lines = text.split("\n");
  const kept: string[] = [];
  let removed = false;
  let inSourcesBlock = false;
  let fence: string | null = null;

  for (const line of lines) {
    const fenceMatch = FENCE_RE.exec(line);
    if (fence) {
      kept.push(line);
      if (fenceMatch?.[1] === fence) fence = null;
      continue;
    }
    if (fenceMatch) {
      fence = fenceMatch[1];
      inSourcesBlock = false;
      kept.push(line);
      continue;
    }

    if (inSourcesBlock) {
      if (LIST_ITEM_RE.test(line) && !URL_RE.test(line)) continue;
      inSourcesBlock = false;
    }

    if (SOURCES_HEADING_RE.test(line)) {
      inSourcesBlock = true;
      removed = true;
      continue;
    }
    if (CITATION_LINE_RE.test(line) && !URL_RE.test(line)) {
      removed = true;
      continue;
    }

    const stripped = stripInlineCitations(line);
    if (stripped === line) {
      kept.push(line);
      continue;
    }
    removed = true;
    // Only the edited line is tidied: "due Nov 20 ." → "due Nov 20."
    kept.push(stripped.replace(/[ \t]+([.,;:!?])/g, "$1").trimEnd());
  }

  if (!removed) return text;
  // Removed lines leave their blank separators behind.
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
