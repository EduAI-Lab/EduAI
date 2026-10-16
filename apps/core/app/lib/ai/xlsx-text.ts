/**
 * Turns the XML parts of an .xlsx workbook into plain text a chat model can read
 * (#1742): one block per sheet, in workbook order, one line per non-empty row with
 * cells separated by " | ". A formula cell shows its saved value and the formula,
 * e.g. `42 (=SUM(B2:B5))`, since marking a spreadsheet is mostly about formulas.
 *
 * The ZIP is opened in the isolated extraction worker; this only reads the XML
 * strings it returns. Dates are left as Excel serial numbers (styles are not read).
 */

export type XlsxParts = {
  workbook: string;
  rels: string;
  sharedStrings: string;
  /** Worksheet XML keyed by its path in the ZIP, e.g. `xl/worksheets/sheet1.xml`. */
  sheets: Record<string, string>;
};

/** Rows and columns read per sheet; past these the sheet says it was cut. */
export const XLSX_MAX_ROWS_PER_SHEET = 2000;
export const XLSX_MAX_COLUMNS = 60;

const ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

export function decodeXmlText(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITIES.get(entity) ?? whole;
  });
}

/** Text of every `<t>` inside a fragment: rich-text runs are joined. */
function joinedText(fragment: string): string {
  const runs = fragment.match(/<t(?:\s[^>]*)?>[\s\S]*?<\/t>|<t(?:\s[^>]*)?\/>/gu) ?? [];
  return decodeXmlText(runs.map((run) => run.replace(/<[^>]*>/gu, "")).join(""));
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}="([^"]*)"`, "u").exec(tag);
  return match ? decodeXmlText(match[1]!) : null;
}

export function parseSharedStrings(xml: string): string[] {
  return (xml.match(/<si>[\s\S]*?<\/si>|<si\/>/gu) ?? []).map(joinedText);
}

/** `C12` → 2 (0-based column). */
export function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/u.exec(reference)?.[0] ?? "";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** Sheets in workbook order, with the ZIP path each one's relationship points at. */
export function workbookSheets(parts: XlsxParts): Array<{ name: string; path: string }> {
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
  return sheets;
}

function cellText(cellXml: string, shared: string[]): string {
  const open = /^<c\b[^>]*>/u.exec(cellXml)?.[0] ?? "";
  const type = attribute(open, "t");
  const value = /<v>([\s\S]*?)<\/v>/u.exec(cellXml)?.[1];
  const formula = /<f\b[^>]*>([\s\S]*?)<\/f>/u.exec(cellXml)?.[1];
  let text: string;
  if (type === "s") text = value === undefined ? "" : (shared[Number(value)] ?? "");
  else if (type === "inlineStr") text = joinedText(/<is>[\s\S]*?<\/is>/u.exec(cellXml)?.[0] ?? "");
  else if (type === "b") text = value === "1" ? "TRUE" : value === "0" ? "FALSE" : "";
  else text = value === undefined ? "" : decodeXmlText(value);
  text = text.replace(/\s+/gu, " ").trim();
  if (formula !== undefined && formula.trim() !== "") {
    const shown = `=${decodeXmlText(formula).trim()}`;
    return text ? `${text} (${shown})` : `(${shown})`;
  }
  return text;
}

/** A sheet's rendered rows, and whether the row or column limit cut it. */
type SheetRows = { rows: string[]; cut: boolean };

function sheetRows(xml: string, shared: string[]): SheetRows {
  const rows: string[] = [];
  let cut = false;
  for (const rowXml of xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/gu) ?? []) {
    const cells: string[] = [];
    let next = 0;
    for (const cellXml of rowXml.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/gu) ?? []) {
      const reference = attribute(/^<c\b[^>]*>/u.exec(cellXml)?.[0] ?? "", "r");
      const column = reference ? columnIndex(reference) : next;
      if (column >= XLSX_MAX_COLUMNS) {
        cut = true;
        continue;
      }
      // Keep columns aligned across rows: a skipped cell is an empty one.
      while (cells.length < column) cells.push("");
      cells[column] = cellXml.endsWith("/>") ? "" : cellText(cellXml, shared);
      next = column + 1;
    }
    while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    if (cells.length === 0) continue;
    if (rows.length >= XLSX_MAX_ROWS_PER_SHEET) {
      cut = true;
      break;
    }
    rows.push(cells.join(" | "));
  }
  return { rows, cut };
}

export type XlsxText = { content: string; sheetCount: number };

export function xlsxToText(parts: XlsxParts): XlsxText {
  const shared = parseSharedStrings(parts.sharedStrings);
  const sheets = workbookSheets(parts);
  const blocks: string[] = [];
  for (const sheet of sheets) {
    const { rows, cut } = sheetRows(parts.sheets[sheet.path] ?? "", shared);
    if (rows.length === 0) continue;
    const note = cut
      ? `\n[Only the first ${XLSX_MAX_ROWS_PER_SHEET} rows and ${XLSX_MAX_COLUMNS} columns of this sheet were included.]`
      : "";
    blocks.push(`--- Sheet: ${sheet.name} ---\n${rows.join("\n")}${note}`);
  }
  return { content: blocks.join("\n\n"), sheetCount: sheets.length };
}
