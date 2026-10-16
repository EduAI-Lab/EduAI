/**
 * Turns the XML parts of an .xlsx workbook into plain text a chat model can read
 * (#1742): one block per sheet, in workbook order, one line per non-empty row with
 * cells separated by " | ". A formula cell shows its saved value and the formula,
 * e.g. `42 (=SUM(B2:B5))`, since marking a spreadsheet is mostly about formulas.
 * Dates are left as Excel serial numbers (styles are not read).
 */

export type XlsxParts = {
  workbook: string;
  rels: string;
  sharedStrings: string;
  /** Worksheet XML keyed by its path in the ZIP, e.g. `xl/worksheets/sheet1.xml`. */
  sheets: Record<string, string>;
};

export type XlsxText = { content: string; sheetCount: number };

/**
 * Rows and columns read per sheet, and characters for the whole workbook; past
 * these the text says it was cut. The character budget bounds what the worker
 * sends back however many sheets or long cells there are (#1990 review); the
 * chat attachment cap trims it further.
 */
export type XlsxLimits = { maxRows: number; maxColumns: number; maxChars: number };

export const XLSX_LIMITS = {
  maxRows: 2000,
  maxColumns: 60,
  maxChars: 200_000,
} satisfies XlsxLimits;

/**
 * The workbook as text.
 *
 * Self-contained on purpose: the extraction worker runs it from its source text
 * (`xlsxToText.toString()`), so the worker returns only the capped text rather
 * than every sheet's inflated XML (#1990 review). It may use only its arguments
 * and plain JavaScript globals: no imports, no module-level constants.
 */
export function xlsxToText(parts: XlsxParts, limits: XlsxLimits): XlsxText {
  const entities = new Map([
    ["amp", "&"],
    ["lt", "<"],
    ["gt", ">"],
    ["quot", '"'],
    ["apos", "'"],
  ]);

  function decode(text: string): string {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, entity: string) => {
      if (!entity.startsWith("#")) return entities.get(entity) ?? whole;
      const hex = entity[1] === "x" || entity[1] === "X";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      // A number past Unicode's range would make fromCodePoint throw and fail the
      // whole file; leave it as written, like an unknown named entity.
      return Number.isSafeInteger(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    });
  }

  /** Text of every `<t>` inside a fragment: rich-text runs are joined. */
  function joinedText(fragment: string): string {
    const runs = fragment.match(/<t(?:\s[^>]*)?>[\s\S]*?<\/t>|<t(?:\s[^>]*)?\/>/gu) ?? [];
    return decode(runs.map((run) => run.replace(/<[^>]*>/gu, "")).join(""));
  }

  // One pattern per attribute name, built once: this runs for every cell.
  const attributePatterns = new Map<string, RegExp>();
  function attribute(tag: string, name: string): string | null {
    let pattern = attributePatterns.get(name);
    if (!pattern) {
      pattern = new RegExp(`\\s${name}="([^"]*)"`, "u");
      attributePatterns.set(name, pattern);
    }
    const match = pattern.exec(tag);
    return match ? decode(match[1]!) : null;
  }

  /** `C12` → 2 (0-based column). */
  function columnIndex(letters: string): number {
    let index = 0;
    for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
    return index - 1;
  }

  function columnLetters(index: number): string {
    let letters = "";
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
    }
    return letters;
  }

  function position(reference: string): { column: number; row: number } | null {
    const match = /^([A-Z]+)(\d+)$/u.exec(reference);
    return match ? { column: columnIndex(match[1]!), row: Number(match[2]) } : null;
  }

  function shiftColumn(anchor: string, letters: string, columns: number): string | null {
    if (anchor) return letters;
    const column = columnIndex(letters) + columns;
    return column < 0 ? null : columnLetters(column);
  }

  function shiftRow(anchor: string, row: string, rows: number): string | null {
    if (anchor) return row;
    const shifted = Number(row) + rows;
    return shifted < 1 ? null : String(shifted);
  }

  /**
   * A shared formula as it reads in another cell of its range: relative
   * references move with the cell, `$`-anchored parts stay. Text in `"…"`,
   * quoted sheet names in `'…'`, and an unquoted sheet name before `!` are
   * never references, so they are left alone; whole-column (`A:A`) and
   * whole-row (`3:3`) ranges move like cells (#1990 re-review).
   */
  function shiftFormula(formula: string, rows: number, columns: number): string {
    const reference =
      /(?<![A-Za-z0-9_.$])(?:(\$?)([A-Z]{1,3})(\$?)(\d+)|(\$?)([A-Z]{1,3}):(\$?)([A-Z]{1,3})|(\$?)(\d+):(\$?)(\d+))(?![A-Za-z0-9_(!])/gu;
    return formula
      .split(/("(?:[^"]|"")*"|'(?:[^']|'')*')/u)
      .map((segment, index) =>
        index % 2 === 1
          ? segment
          : segment.replace(reference, (whole, ...groups: Array<string | undefined>) => {
              const [ca, cl, ra, rn, c1a, c1, c2a, c2, r1a, r1, r2a, r2] = groups as string[];
              if (cl !== undefined) {
                const column = shiftColumn(ca!, cl, columns);
                const row = shiftRow(ra!, rn!, rows);
                return column && row ? `${ca}${column}${ra}${row}` : whole;
              }
              if (c1 !== undefined) {
                const from = shiftColumn(c1a!, c1, columns);
                const to = shiftColumn(c2a!, c2!, columns);
                return from && to ? `${c1a}${from}:${c2a}${to}` : whole;
              }
              const from = shiftRow(r1a!, r1!, rows);
              const to = shiftRow(r2a!, r2!, rows);
              return from && to ? `${r1a}${from}:${r2a}${to}` : whole;
            }),
      )
      .join("");
  }

  const shared = (parts.sharedStrings.match(/<si>[\s\S]*?<\/si>|<si\/>/gu) ?? []).map(joinedText);

  // Sheets in workbook order, with the ZIP path each one's relationship points at.
  const targets = new Map<string, string>();
  for (const rel of parts.rels.match(/<Relationship\b[^>]*>/gu) ?? []) {
    const id = attribute(rel, "Id");
    const target = attribute(rel, "Target");
    if (!id || !target) continue;
    // Targets are relative to xl/ ("worksheets/sheet1.xml") or absolute ("/xl/...").
    targets.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  const sheets: Array<{ name: string; path: string }> = [];
  for (const tag of parts.workbook.match(/<sheet\b[^>]*>/gu) ?? []) {
    const name = attribute(tag, "name");
    const id = attribute(tag, "r:id");
    const path = id ? targets.get(id) : undefined;
    if (name && path && parts.sheets[path] !== undefined) sheets.push({ name, path });
  }
  // A workbook whose relationships could not be read still has its sheets.
  if (sheets.length === 0) {
    for (const path of Object.keys(parts.sheets).sort()) {
      sheets.push({ name: path.replace(/^.*\/|\.xml$/gu, ""), path });
    }
  }

  const blocks: string[] = [];
  let used = 0;
  let outOfBudget = false;
  for (const sheet of sheets) {
    if (outOfBudget) break;
    const xml = parts.sheets[sheet.path] ?? "";
    const cellPattern = /<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/gu;

    // A filled-down formula is stored once, in its anchor cell; the rest of the
    // range carries only `<f t="shared" si="n"/>` (#1990 review). The anchor is
    // the range's top-left cell, so it is always read before the cells that
    // share it, and anchors are collected as the capped pass reaches them.
    const anchors = new Map<string, { formula: string; column: number; row: number }>();

    function formulaOf(cellXml: string, at: { column: number; row: number } | null): string | null {
      const full = /<f\b([^>]*)>([\s\S]*?)<\/f>/u.exec(cellXml);
      if (full && full[2]!.trim()) {
        const formula = decode(full[2]!).trim();
        const index = attribute(` ${full[1]}`, "si");
        if (at && index !== null && attribute(` ${full[1]}`, "t") === "shared") {
          anchors.set(index, { formula, ...at });
        }
        return formula;
      }
      const sharedTag = /<f\b([^>]*)\/>|<f\b([^>]*)><\/f>/u.exec(cellXml);
      if (!sharedTag) return null;
      const index = attribute(` ${sharedTag[1] ?? sharedTag[2] ?? ""}`, "si");
      const anchor = index === null ? undefined : anchors.get(index);
      if (!anchor || !at) return null;
      return shiftFormula(anchor.formula, at.row - anchor.row, at.column - anchor.column);
    }

    function cellText(cellXml: string, at: { column: number; row: number } | null): string {
      const open = /^<c\b[^>]*>/u.exec(cellXml)?.[0] ?? "";
      const type = attribute(open, "t");
      const value = /<v>([\s\S]*?)<\/v>/u.exec(cellXml)?.[1];
      let text: string;
      if (type === "s") text = value === undefined ? "" : (shared[Number(value)] ?? "");
      else if (type === "inlineStr")
        text = joinedText(/<is>[\s\S]*?<\/is>/u.exec(cellXml)?.[0] ?? "");
      else if (type === "b") text = value === "1" ? "TRUE" : value === "0" ? "FALSE" : "";
      else text = value === undefined ? "" : decode(value);
      text = text.replace(/\s+/gu, " ").trim();
      const formula = formulaOf(cellXml, at);
      if (formula) return text ? `${text} (=${formula})` : `(=${formula})`;
      return text;
    }

    const rows: string[] = [];
    let cut = false;
    for (const rowXml of xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/gu) ?? []) {
      const cells: string[] = [];
      let next = 0;
      for (const cellXml of rowXml.match(cellPattern) ?? []) {
        const reference = attribute(/^<c\b[^>]*>/u.exec(cellXml)?.[0] ?? "", "r");
        const at = reference ? position(reference) : null;
        const column = at ? at.column : next;
        if (column >= limits.maxColumns) {
          cut = true;
          continue;
        }
        // Keep columns aligned across rows: a skipped cell is an empty one.
        while (cells.length < column) cells.push("");
        cells[column] = cellXml.endsWith("/>") ? "" : cellText(cellXml, at);
        next = column + 1;
      }
      while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
      if (cells.length === 0) continue;
      if (rows.length >= limits.maxRows) {
        cut = true;
        break;
      }
      const line = cells.join(" | ");
      if (used + line.length + 1 > limits.maxChars) {
        outOfBudget = true;
        break;
      }
      used += line.length + 1;
      rows.push(line);
    }
    if (rows.length === 0) continue;
    const note = cut
      ? `\n[Only the first ${limits.maxRows} rows and ${limits.maxColumns} columns of this sheet were included.]`
      : "";
    blocks.push(`--- Sheet: ${sheet.name} ---\n${rows.join("\n")}${note}`);
  }
  if (outOfBudget) {
    blocks.push(
      `[Stopped after ${limits.maxChars.toLocaleString("en-US")} characters; the rest of the workbook was left out.]`,
    );
  }
  return { content: blocks.join("\n\n"), sheetCount: sheets.length };
}
