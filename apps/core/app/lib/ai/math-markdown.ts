/**
 * Normalize model-produced math into markdown that Streamdown/KaTeX can render.
 */

import { debugMathMarkdown } from "./math-markdown-debug";

const MATH_COMMAND =
  /\\(?:frac|sqrt|sum|int|prod|lim|sin|cos|tan|log|ln|alpha|beta|gamma|delta|theta|pi|infty|cdot|times|div|pm|mp|leq|geq|neq|approx|left|right|text|vec|hat|bar|overline|underline|binom|displaystyle|quad|qquad|mathrm|mathbf|operatorname)\b/;

const DISPLAY_DELIM_RE = /\\\[([\s\S]*?)\\\]/g;
const INLINE_DELIM_RE = /\\\(([\s\S]*?)\\\)/g;
const INLINE_MATH_RE = /(?<!\\)\$([^$\n]+?)(?<!\\)\$/g;

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

function repairBrokenDelimiterNesting(text: string): string {
  let prev = "";
  let cur = text;
  while (prev !== cur) {
    prev = cur;
    cur = cur
      .replace(/\$\s*\\left\s*\(\s*\$/g, "$\\left(")
      .replace(/\$\s*\\right\s*\)\s*\$/g, "\\right)$")
      .replace(/([+\-=])\s*\$\s*(?=\\)/g, "$1 ")
      .replace(/\s*\$\s*([+\-=])/g, " $1");
  }
  return cur;
}

function consolidateEquationText(text: string): string {
  return repairBrokenDelimiterNesting(text)
    .replace(/(?<!\\)\$/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([+\-=])\s*/g, " $1 ")
    .trim();
}

function countInlineMathSegments(line: string): number {
  return (line.match(INLINE_MATH_RE) ?? []).length;
}

function hasBareMathOutsideDelimiters(line: string): boolean {
  const withoutDelimited = line.replace(INLINE_MATH_RE, "");
  return (
    /[a-zA-Z]\^|\\frac|\\left|\\sqrt/.test(withoutDelimited) &&
    (/=/.test(withoutDelimited) || /\\left/.test(withoutDelimited))
  );
}

function hasFragmentedEquationMath(line: string): boolean {
  if (/\$\s*\\left\s*\(\s*\$/.test(line)) return true;

  const segments = countInlineMathSegments(line);
  if (segments >= 2 && (/=/.test(line) || MATH_COMMAND.test(line))) {
    return true;
  }

  if (!hasBareMathOutsideDelimiters(line)) return false;
  return segments >= 1 || MATH_COMMAND.test(line);
}

function looksLikeEquationTail(text: string): boolean {
  const t = consolidateEquationText(text);
  if (!t) return false;
  return /=/.test(t) && (MATH_COMMAND.test(t) || /[a-zA-Z]\^/.test(t));
}

function findEquationTailStart(line: string): number {
  let best = -1;
  const patterns = [/\ba\\left/g, /\bx\^2/g, /\bx\s*=/g, /\\frac/g, /\\left/g];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    const re = new RegExp(pattern.source, pattern.flags);
    while ((match = re.exec(line)) !== null) {
      if (!isInsideExistingMath(line, match.index)) {
        best = Math.max(best, match.index);
      }
    }
  }

  return best;
}

function extractTrailingEquation(line: string): { prefix: string; equation: string } | null {
  const afterBoldStep = line.match(/:\*\*\s+([\s\S]+)$/)?.[1];
  if (afterBoldStep && /^(x\^2|x\s*=|a\\left|\\frac|\\left)/.test(afterBoldStep.trimStart())) {
    if (looksLikeEquationTail(afterBoldStep) || /\\left/.test(afterBoldStep)) {
      const prefix = line.slice(0, line.length - afterBoldStep.length).trimEnd();
      return { prefix, equation: afterBoldStep.trim() };
    }
  }

  const tailStart = findEquationTailStart(line);
  if (tailStart <= 0) return null;

  const equation = line.slice(tailStart).trim();
  const prefix = line.slice(0, tailStart).trimEnd();
  if (!looksLikeEquationTail(equation) && !/\\left/.test(equation)) return null;
  if (!hasFragmentedEquationMath(equation) && !looksLikeDisplayMathLine(equation)) return null;

  return { prefix, equation };
}

function wrapDisplayMath(equation: string): string {
  return `$$\n${consolidateEquationText(equation)}\n$$`;
}

function lineHasMathDelimiters(line: string): boolean {
  const t = line.trim();
  return /(?<!\\)\$\$/.test(t) || /(?<!\\)\$[^$\n]+\$/.test(t);
}

function looksLikeDisplayMathLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 800) return false;
  if (/^\$\$/.test(t)) return false;
  if (hasFragmentedEquationMath(t)) return true;
  if (lineHasMathDelimiters(t)) return false;
  if (/^#{1,6}\s/.test(t)) return false;
  if (/^\*\*[^*]+/.test(t) && !MATH_COMMAND.test(t)) return false;

  const hasLatexCommand = MATH_COMMAND.test(t);
  const hasSupSub = /[a-zA-Z0-9]\^[{0-9a-zA-Z+]|_[{0-9a-zA-Z]/.test(t);
  const hasEquation = /=/.test(t);

  if (hasLatexCommand && (hasEquation || hasSupSub || /\\left/.test(t))) return true;
  if (hasEquation && hasSupSub && /^[0-9a-zA-Z\s\\^_{}+\-*/().=,\[\]|]+$/.test(t)) {
    return true;
  }

  return false;
}

/** Merge `$a(x^2 +` + `$\frac{b}{a}x) = -c$` split across lines. */
function mergeUnbalancedDollarLines(text: string): string {
  const lines = text.split("\n");
  const merged: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    let dollars = (line.match(/(?<!\\)\$/g) ?? []).length;
    while (dollars % 2 === 1 && i + 1 < lines.length) {
      i++;
      line += `\n${lines[i]}`;
      dollars = (line.match(/(?<!\\)\$/g) ?? []).length;
    }
    merged.push(line);
  }

  return merged.join("\n");
}

function isWholeLineEquation(line: string): boolean {
  const t = line.trim();
  if (!t || /^\d+\.\s/.test(t)) return false;
  if (/:\*\*\s/.test(t) || (/\*\*/.test(t) && /[A-Za-z]{4,}/.test(t.replace(/\*\*/g, " ")))) {
    return false;
  }
  return looksLikeDisplayMathLine(t);
}

function normalizeFragmentedLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || /^\$\$/.test(trimmed)) return line;

  const indent = line.match(/^\s*/)?.[0] ?? "";

  if (isWholeLineEquation(trimmed)) {
    return `${indent}${wrapDisplayMath(trimmed)}`;
  }

  if (!hasFragmentedEquationMath(trimmed)) return line;

  const trailing = extractTrailingEquation(trimmed);
  if (trailing) {
    const prefix = trailing.prefix.trimEnd();
    const block = wrapDisplayMath(trailing.equation);
    return prefix ? `${indent}${prefix}\n\n${block}` : `${indent}${block}`;
  }

  if (
    !/\*\*/.test(trimmed) &&
    !/^\d+\.\s/.test(trimmed) &&
    (looksLikeEquationTail(trimmed) || (/\\left/.test(trimmed) && MATH_COMMAND.test(trimmed)))
  ) {
    return `${indent}${wrapDisplayMath(trimmed)}`;
  }

  return line;
}

function normalizeLineMath(text: string): string {
  return text
    .split("\n")
    .map((line) => normalizeFragmentedLine(line))
    .join("\n");
}

function wrapBareDisplayMathLines(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || /^\$\$/.test(trimmed)) return line;
      if (!looksLikeDisplayMathLine(trimmed) || hasFragmentedEquationMath(trimmed)) return line;
      const indent = line.match(/^\s*/)?.[0] ?? "";
      return `${indent}${wrapDisplayMath(trimmed)}`;
    })
    .join("\n");
}

function repairSpacedBoldMarkers(text: string): string {
  return text.replace(/^\*\s+\*\s+(.+?)\s+\*\s+\*$/gm, (match, inner: string) => {
    const parts = inner.trim().split(/\s+/);
    if (parts.length < 4) return match;
    const singleCharRatio = parts.filter((p) => p.length === 1).length / parts.length;
    if (singleCharRatio < 0.65) return match;
    return `**${parts.join("")}**`;
  });
}

export function normalizeMathMarkdown(text: string): string {
  if (!text) return text;

  const mayContainMath = /\\|(?<!\\)\$|[a-zA-Z]\^|_\{|=/.test(text);
  if (!mayContainMath) {
    return repairSpacedBoldMarkers(text);
  }

  debugMathMarkdown("input", { before: text });

  let result = decodeHtmlEntities(text);
  result = repairSpacedBoldMarkers(result);
  debugMathMarkdown("after-repair-bold", { after: result });

  result = mergeUnbalancedDollarLines(result);
  debugMathMarkdown("after-merge-dollars", { after: result });

  result = result.replace(DISPLAY_DELIM_RE, (_, body) => `$$\n${body.trim()}\n$$`);
  result = result.replace(INLINE_DELIM_RE, (_, body) => `$${body.trim()}$`);
  debugMathMarkdown("after-delimiter-convert", { after: result });

  result = normalizeLineMath(result);
  debugMathMarkdown("after-normalize-lines", { after: result });

  result = wrapBareDisplayMathLines(result);
  debugMathMarkdown("output", { after: result });

  return result;
}
