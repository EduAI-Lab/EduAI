/**
 * Model-written course-material citations (#1936).
 *
 * A chat model writes "(Source: …)" from memory of the excerpt headers, and a
 * small one gets the name wrong — "L14" came back as "L15", a file that doesn't
 * exist. The materials a turn actually retrieved are listed under the message
 * from server metadata instead, so the model's own citations are removed from
 * what the student sees. Citations that carry a URL are left alone: those come
 * from web tools, and the link itself is checkable.
 */

const URL_RE = /https?:\/\/|www\./i;

/** "(Source: X)", "*(Sources: X)*", "[Source: X]" — anywhere in a line. */
const INLINE_CITATION_RE =
  /\s*[*_]{0,2}[([]\s*[*_]{0,2}sources?[*_]{0,2}\s*:[^)\]\n]*[)\]][*_]{0,2}/gi;

/** A line that is only a citation: "Source: X", "**Sources**: X", "- *Source*: X". */
const CITATION_LINE_RE = /^\s*(?:[-*>]\s+)?[*_]{0,2}sources?[*_]{0,2}\s*:/i;

/** A bare "Sources" heading whose list follows on the next lines. */
const SOURCES_HEADING_RE = /^\s*(?:#{1,6}\s*)?[*_]{0,2}sources?[*_]{0,2}\s*:?\s*$/i;

const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;

/** Remove model-written material citations, keeping URL citations and ordinary prose. */
export function stripModelSourceCitations(text: string): string {
  if (!/sources?/i.test(text)) return text;

  const lines = text.split("\n");
  const kept: string[] = [];
  let removed = false;
  let inSourcesBlock = false;

  for (const line of lines) {
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

    const stripped = line.replace(INLINE_CITATION_RE, (citation) =>
      URL_RE.test(citation) ? citation : "",
    );
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
