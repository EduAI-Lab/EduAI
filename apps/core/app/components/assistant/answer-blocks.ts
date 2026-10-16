/**
 * @file Parse a model answer into a small block tree (#1822). Pure.
 *
 * The widget renders every leaf of this tree as TEXT CONTENT, never as HTML, so a
 * model answer containing `<script>` or `<img onerror>` is inert visible text. The
 * grammar is deliberately tiny — paragraphs, ordered and unordered lists, fenced
 * code, inline bold and inline code — which is all the grounding prompt asks for.
 */

export type InlineSpan = { kind: "text" | "bold" | "code"; text: string };

export type AnswerBlock =
  | { kind: "paragraph"; spans: InlineSpan[] }
  | { kind: "list"; ordered: boolean; items: InlineSpan[][] }
  | { kind: "code"; language: string; text: string };

const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const ORDERED_ITEM = /^\s*\d+[.)]\s+(.*)$/;
const UNORDERED_ITEM = /^\s*[-*•]\s+(.*)$/;

/** `**bold**` and `` `code` `` inside one line. Unmatched markers stay literal text. */
export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) spans.push({ kind: "text", text: text.slice(last, index) });
    if (match[2] !== undefined) spans.push({ kind: "bold", text: match[2] });
    else spans.push({ kind: "code", text: match[3] ?? "" });
    last = index + match[0].length;
  }
  if (last < text.length) spans.push({ kind: "text", text: text.slice(last) });
  return spans;
}

export function parseAnswer(answer: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  const lines = answer.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", spans: parseInline(paragraph.join(" ").trim()) });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ kind: "list", ordered: list.ordered, items: list.items.map(parseInline) });
      list = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      flushList();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) body.push(lines[i++]);
      blocks.push({ kind: "code", language: fence[1] ?? "", text: body.join("\n") });
      continue;
    }

    const ordered = ORDERED_ITEM.exec(line);
    const unordered = ordered ? null : UNORDERED_ITEM.exec(line);
    const item = ordered ?? unordered;
    if (item) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (list && list.ordered !== isOrdered) flushList();
      list ??= { ordered: isOrdered, items: [] };
      list.items.push(item[1].trim());
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    // A continuation line indented under a list item belongs to that item.
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    // Strip Markdown heading markers; headings render as an ordinary paragraph.
    paragraph.push(line.replace(/^\s*#{1,6}\s+/, ""));
  }
  flushParagraph();
  flushList();
  return blocks;
}

/**
 * A source URL becomes an href only if it is a same-origin absolute PATH. The
 * server only ever sends those, but the client re-validates rather than trusting
 * a response by construction: `javascript:`, `data:`, protocol-relative `//host`
 * and any absolute URL are all refused.
 */
export function safeSourceHref(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) return null;
  // Control characters can smuggle a scheme past naive prefix checks.
  for (const char of trimmed) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return null;
  }
  return trimmed;
}
