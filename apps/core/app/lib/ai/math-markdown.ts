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
  if (!text || !/\\|(?<!\\)\$/.test(text)) {
    return text;
  }

  let result = decodeHtmlEntities(text);
  result = result.replace(DISPLAY_DELIM_RE, (_, body) => `$$\n${body.trim()}\n$$`);
  result = result.replace(INLINE_DELIM_RE, (_, body) => `$${body.trim()}$`);
  result = wrapBareLatexExpressions(result);
  return result;
}
