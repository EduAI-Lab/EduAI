/**
 * Normalize model-produced math into markdown that Streamdown/KaTeX can render.
 * Handles common LaTeX delimiter styles and bare `\frac{}{}`-style expressions.
 */

const MATH_COMMAND =
  /\\(?:frac|sqrt|sum|int|prod|lim|sin|cos|tan|log|ln|alpha|beta|gamma|delta|theta|pi|infty|cdot|times|div|pm|mp|leq|geq|neq|approx|left|right|text|vec|hat|bar|overline|underline|binom|displaystyle|quad|qquad|mathrm|mathbf|operatorname)\b/;

const DISPLAY_DELIM_RE = /\\\[([\s\S]*?)\\\]/g;
const INLINE_DELIM_RE = /\\\(([\s\S]*?)\\\)/g;

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function isInsideExistingMath(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const inlineOpens = (before.match(/(?<!\\)\$/g) ?? []).length;
  if (inlineOpens % 2 === 1) return true;

  const displayOpens = (before.match(/(?<!\\)\$\$/g) ?? []).length;
  return displayOpens % 2 === 1;
}

function readBalancedBraces(text: string, openIndex: number): number {
  if (text[openIndex] !== "{") return openIndex;
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

function readLatexExpression(text: string, start: number): number {
  let i = start;
  while (i < text.length && text[i] === "\\") {
    const commandMatch = text.slice(i).match(/^\\[a-zA-Z]+/);
    if (!commandMatch) break;
    i += commandMatch[0].length;
    while (text[i] === "{") {
      i = readBalancedBraces(text, i) + 1;
    }
    while (text[i] === "^" || text[i] === "_") {
      i++;
      if (text[i] === "{") {
        i = readBalancedBraces(text, i) + 1;
      } else if (text[i]) {
        i++;
      }
    }
  }

  return Math.max(i, start + 1);
}

function lineHasMathDelimiters(line: string): boolean {
  const t = line.trim();
  return /(?<!\\)\$\$/.test(t) || /(?<!\\)\$[^$\n]+\$/.test(t);
}

function looksLikeDisplayMathLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 600) return false;
  if (lineHasMathDelimiters(t)) return false;

  // Markdown structure — not a bare equation line
  if (/^#{1,6}\s/.test(t)) return false;
  if (/^\*\*[^*]+/.test(t) && !MATH_COMMAND.test(t)) return false;
  if (/^[-*+]\s+\S/.test(t) && !MATH_COMMAND.test(t) && !/[a-zA-Z]\^/.test(t)) return false;

  const hasLatexCommand = MATH_COMMAND.test(t);
  const hasSupSub = /[a-zA-Z0-9]\^[{0-9a-zA-Z+]|_[{0-9a-zA-Z]/.test(t);
  const hasEquation = /=/.test(t);

  if (hasLatexCommand && (hasEquation || hasSupSub)) return true;

  // e.g. x^2 + bx = -c (no leading backslash)
  if (hasEquation && hasSupSub && /^[0-9a-zA-Z\s\\^_{}+\-*/().=,\[\]|]+$/.test(t)) {
    return true;
  }

  return false;
}

function wrapBareDisplayMathLines(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!looksLikeDisplayMathLine(trimmed)) return line;
      const indent = line.match(/^\s*/)?.[0] ?? "";
      return `${indent}$$\n${trimmed}\n$$`;
    })
    .join("\n");
}

/** Model sometimes emits `* * S i m p l i f y ... * *` instead of `**Simplify...**`. */
function repairSpacedBoldMarkers(text: string): string {
  return text.replace(/^\*\s+\*\s+(.+?)\s+\*\s+\*$/gm, (match, inner: string) => {
    const parts = inner.trim().split(/\s+/);
    if (parts.length < 4) return match;
    const singleCharRatio = parts.filter((p) => p.length === 1).length / parts.length;
    if (singleCharRatio < 0.65) return match;
    return `**${parts.join("")}**`;
  });
}

function wrapBareLatexExpressions(text: string): string {
  let result = "";
  let cursor = 0;

  while (cursor < text.length) {
    const next = text.indexOf("\\", cursor);
    if (next === -1) {
      result += text.slice(cursor);
      break;
    }

    result += text.slice(cursor, next);

    if (isInsideExistingMath(text, next)) {
      result += "\\";
      cursor = next + 1;
      continue;
    }

    const tail = text.slice(next);
    if (!MATH_COMMAND.test(tail)) {
      result += "\\";
      cursor = next + 1;
      continue;
    }

    const end = readLatexExpression(text, next);
    const expr = text.slice(next, end).trim();
    if (expr.length > 0) {
      result += `$${expr}$`;
      cursor = end;
    } else {
      result += "\\";
      cursor = next + 1;
    }
  }

  return result;
}

/**
 * Convert common LaTeX delimiter styles and bare commands into `$...$` / `$$...$$`.
 */
export function normalizeMathMarkdown(text: string): string {
  if (!text) return text;

  const mayContainMath = /\\|(?<!\\)\$|[a-zA-Z]\^|_\{|=/.test(text);
  if (!mayContainMath) {
    return repairSpacedBoldMarkers(text);
  }

  let result = decodeHtmlEntities(text);
  result = repairSpacedBoldMarkers(result);
  result = result.replace(DISPLAY_DELIM_RE, (_, body) => `$$\n${body.trim()}\n$$`);
  result = result.replace(INLINE_DELIM_RE, (_, body) => `$${body.trim()}$`);
  result = wrapBareDisplayMathLines(result);
  result = wrapBareLatexExpressions(result);
  return result;
}
