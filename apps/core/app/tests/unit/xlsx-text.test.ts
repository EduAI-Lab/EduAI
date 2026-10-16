import { describe, expect, it } from "vitest";
import { XLSX_LIMITS, xlsxToText as render, type XlsxParts } from "~/lib/ai/xlsx-text";

const XLSX_MAX_ROWS_PER_SHEET = XLSX_LIMITS.maxRows;
const xlsxToText = (parts: XlsxParts) => render(parts, XLSX_LIMITS);

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

function workbook(sheets: Array<{ name: string; xml: string }>, sharedStrings = ""): XlsxParts {
  return {
    workbook: `<workbook ${NS} xmlns:r="r"><sheets>${sheets
      .map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`,
    rels: `<Relationships>${sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="ws" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("")}</Relationships>`,
    sharedStrings: `<sst ${NS}>${sharedStrings}</sst>`,
    sheets: Object.fromEntries(
      sheets.map((s, i) => [
        `xl/worksheets/sheet${i + 1}.xml`,
        `<worksheet ${NS}><sheetData>${s.xml}</sheetData></worksheet>`,
      ]),
    ),
  };
}

describe("xlsxToText (#1742)", () => {
  it("reads shared strings, numbers and formulas, one line per row", () => {
    const parts = workbook(
      [
        {
          name: "Grades",
          xml:
            '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
            '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>78</v></c></row>' +
            '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><f>AVERAGE(B2:B2)</f><v>78</v></c></row>',
        },
      ],
      "<si><t>Student</t></si><si><t>Score</t></si><si><t>Ana</t></si><si><t>Mean</t></si>",
    );
    expect(xlsxToText(parts)).toEqual({
      content: "--- Sheet: Grades ---\nStudent | Score\nAna | 78\nMean | 78 (=AVERAGE(B2:B2))",
      sheetCount: 1,
    });
  });

  it("keeps columns aligned when cells are missing, and drops empty rows", () => {
    const parts = workbook([
      {
        name: "S",
        xml:
          '<row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c></row>' +
          '<row r="2"><c r="B2"/></row>' +
          '<row r="3"><c r="B3"><v>2</v></c></row>',
      },
    ]);
    expect(xlsxToText(parts).content).toBe("--- Sheet: S ---\n1 |  | 3\n | 2");
  });

  it("reads inline strings, booleans, rich text and escaped characters", () => {
    const parts = workbook(
      [
        {
          name: "Mixed",
          xml:
            '<row r="1"><c r="A1" t="inlineStr"><is><t>x &lt; y &amp; z</t></is></c>' +
            '<c r="B1" t="b"><v>1</v></c><c r="C1" t="s"><v>0</v></c></row>',
        },
      ],
      '<si><r><t>bold</t></r><r><t xml:space="preserve"> part</t></r></si>',
    );
    expect(xlsxToText(parts).content).toBe("--- Sheet: Mixed ---\nx < y & z | TRUE | bold part");
  });

  it("lists sheets in workbook order under their names, skipping empty ones", () => {
    const parts = workbook([
      { name: "Second &amp; last", xml: '<row r="1"><c r="A1"><v>2</v></c></row>' },
      { name: "Empty", xml: "" },
    ]);
    parts.workbook = parts.workbook.replace("Second &amp; last", "Data");
    expect(xlsxToText(parts)).toEqual({ content: "--- Sheet: Data ---\n2", sheetCount: 2 });
  });

  it("shows a formula with no saved value", () => {
    const parts = workbook([{ name: "S", xml: '<row r="1"><c r="A1"><f>NOW()</f></c></row>' }]);
    expect(xlsxToText(parts).content).toBe("--- Sheet: S ---\n(=NOW())");
  });

  it("says when a sheet was cut to the row or column limit", () => {
    const rows = Array.from(
      { length: XLSX_MAX_ROWS_PER_SHEET + 5 },
      (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`,
    ).join("");
    const content = xlsxToText(workbook([{ name: "Big", xml: rows }])).content;
    expect(content.split("\n")).toHaveLength(XLSX_MAX_ROWS_PER_SHEET + 2);
    expect(content).toMatch(
      /\[Only the first 2000 rows and 60 columns of this sheet were included\.\]$/u,
    );

    const wide = `<row r="1"><c r="A1"><v>a</v></c><c r="CZ1"><v>far</v></c></row>`;
    // CZ is column 104, past the 60-column limit.
    const cutWide = xlsxToText(workbook([{ name: "Wide", xml: wide }])).content;
    expect(cutWide).toContain("[Only the first");
    expect(cutWide).not.toContain("far");
  });

  it("falls back to the worksheet files when the relationships are unreadable", () => {
    const parts = workbook([{ name: "S", xml: '<row r="1"><c r="A1"><v>7</v></c></row>' }]);
    parts.rels = "";
    expect(xlsxToText(parts).content).toBe("--- Sheet: sheet1 ---\n7");
  });
});

describe("cell positions and characters", () => {
  const oneCell = (ref: string, inner: string) =>
    xlsxToText(workbook([{ name: "S", xml: `<row r="1"><c r="${ref}"${inner}</c></row>` }]))
      .content;

  it.each([
    ["A1", 0],
    ["Z1", 25],
    ["AA1", 26],
    ["AZ1", 51],
  ])("places %s in column %i", (ref, index) => {
    expect(oneCell(ref, "><v>x</v>")).toBe(`--- Sheet: S ---\n${" | ".repeat(index)}x`);
  });

  it("decodes named and numeric entities", () => {
    expect(
      oneCell("A1", ' t="inlineStr"><is><t>&quot;a&apos; &#233; &#x263A; &bogus;</t></is>'),
    ).toBe("--- Sheet: S ---\n\"a' é ☺ &bogus;");
  });

  // #1990 review: fromCodePoint throws past U+10FFFF, which used to fail the whole file.
  it("leaves a character reference past Unicode's range as written", () => {
    expect(oneCell("A1", ' t="inlineStr"><is><t>a &#x110000; &#99999999999; b</t></is>')).toBe(
      "--- Sheet: S ---\na &#x110000; &#99999999999; b",
    );
  });

  it("reads an empty shared string", () => {
    const parts = workbook(
      [
        {
          name: "S",
          xml: '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>',
        },
      ],
      "<si/><si><t>x</t></si>",
    );
    expect(xlsxToText(parts).content).toBe("--- Sheet: S ---\n | x");
  });
});

// #1990 review: a filled-down formula is stored once, in its anchor cell.
describe("shared formulas", () => {
  it("shows each filled-down cell's own formula, shifted from the anchor", () => {
    const xml =
      '<row r="2"><c r="C2"><f t="shared" ref="C2:C4" si="0">A2*B2</f><v>6</v></c></row>' +
      '<row r="3"><c r="C3"><f t="shared" si="0"/><v>12</v></c></row>' +
      '<row r="4"><c r="C4"><f t="shared" si="0"/><v>20</v></c></row>';
    expect(xlsxToText(workbook([{ name: "S", xml }])).content).toBe(
      "--- Sheet: S ---\n |  | 6 (=A2*B2)\n |  | 12 (=A3*B3)\n |  | 20 (=A4*B4)",
    );
  });

  it("keeps $-anchored parts, shifts across columns, and leaves functions and text alone", () => {
    const xml =
      '<row r="1"><c r="B1"><f t="shared" ref="B1:C1" si="3">SUM($A1:A1)+LOG10(A$1)&amp;"A1"</f><v>1</v></c>' +
      '<c r="C1"><f t="shared" si="3"/><v>2</v></c></row>';
    expect(xlsxToText(workbook([{ name: "S", xml }])).content).toBe(
      '--- Sheet: S ---\n | 1 (=SUM($A1:A1)+LOG10(A$1)&"A1") | 2 (=SUM($A1:B1)+LOG10(B$1)&"A1")',
    );
  });

  // #1990 re-review: sheet names are not references, and whole rows/columns move.
  const filledDown = (anchorFormula: string) =>
    xlsxToText(
      workbook([
        {
          name: "S",
          xml:
            `<row r="2"><c r="A2"><f t="shared" ref="A2:A3" si="0">${anchorFormula}</f><v>1</v></c></row>` +
            '<row r="3"><c r="A3"><f t="shared" si="0"/><v>2</v></c></row>',
        },
      ]),
    ).content.split("\n")[2];
  const filledRight = (anchorFormula: string) =>
    xlsxToText(
      workbook([
        {
          name: "S",
          xml:
            `<row r="1"><c r="A1"><f t="shared" ref="A1:B1" si="0">${anchorFormula}</f><v>1</v></c>` +
            '<c r="B1"><f t="shared" si="0"/><v>2</v></c></row>',
        },
      ]),
    ).content.split(" | ")[1];

  it.each([
    ["a quoted sheet name that looks like a cell", "&apos;Q1&apos;!B2", "2 (='Q1'!B3)"],
    ["an unquoted sheet name that looks like a cell", "Q1!B2", "2 (=Q1!B3)"],
    ["a quoted sheet name with spaces", "&apos;Lab Q1&apos;!B2*2", "2 (='Lab Q1'!B3*2)"],
    ["a whole-row range", "SUM(3:3)", "2 (=SUM(4:4))"],
    ["an anchored whole-row range", "SUM($3:3)", "2 (=SUM($3:4))"],
  ])("filled down, shifts %s correctly", (_label, formula, expected) => {
    expect(filledDown(formula)).toBe(expected);
  });

  it.each([
    ["a whole-column range", "SUM(A:A)", "2 (=SUM(B:B))"],
    ["an anchored whole-column range", "SUM($A:A)", "2 (=SUM($A:B))"],
    ["a sheet-qualified whole column", "SUM(Q1!A:A)", "2 (=SUM(Q1!B:B))"],
  ])("filled right, shifts %s correctly", (_label, formula, expected) => {
    expect(filledRight(formula)).toBe(expected);
  });

  it("collects an anchor in the same pass as the rows, before the cells that share it", () => {
    const xml =
      '<row r="1"><c r="A1"><v>head</v></c></row>' +
      '<row r="2"><c r="B2"><f t="shared" ref="B2:B3" si="4">A2+1</f><v>2</v></c></row>' +
      '<row r="3"><c r="B3"><f t="shared" si="4"/><v>3</v></c></row>';
    expect(xlsxToText(workbook([{ name: "S", xml }])).content).toBe(
      "--- Sheet: S ---\nhead\n | 2 (=A2+1)\n | 3 (=A3+1)",
    );
  });

  it("shows only the value when the anchor is missing", () => {
    const xml = '<row r="3"><c r="C3"><f t="shared" si="9"/><v>12</v></c></row>';
    expect(xlsxToText(workbook([{ name: "S", xml }])).content).toBe("--- Sheet: S ---\n |  | 12");
  });
});

// #1990 re-review: a whole-workbook character budget bounds the worker's output.
describe("character budget", () => {
  it("stops when the budget is reached and says the rest was left out", () => {
    const row = (n: number) => `<row r="${n}"><c r="A${n}"><v>${"x".repeat(40)}</v></c></row>`;
    const many = Array.from({ length: 50 }, (_, i) => row(i + 1)).join("");
    const parts = workbook([
      { name: "First", xml: many },
      { name: "Second", xml: row(1) },
    ]);
    const { content } = render(parts, { ...XLSX_LIMITS, maxChars: 500 });
    expect(content).toContain("--- Sheet: First ---");
    expect(content).not.toContain("--- Sheet: Second ---");
    expect(content).toMatch(
      /\[Stopped after 500 characters; the rest of the workbook was left out\.\]$/u,
    );
    expect(content.length).toBeLessThan(700);
  });
});
