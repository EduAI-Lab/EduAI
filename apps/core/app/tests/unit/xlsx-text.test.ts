import { describe, expect, it } from "vitest";
import {
  XLSX_MAX_COLUMNS,
  XLSX_MAX_ROWS_PER_SHEET,
  columnIndex,
  decodeXmlText,
  parseSharedStrings,
  xlsxToText,
  type XlsxParts,
} from "~/lib/ai/xlsx-text";

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
    expect(columnIndex("CZ1")).toBeGreaterThanOrEqual(XLSX_MAX_COLUMNS);
    expect(xlsxToText(workbook([{ name: "Wide", xml: wide }])).content).toContain(
      "[Only the first",
    );
  });

  it("falls back to the worksheet files when the relationships are unreadable", () => {
    const parts = workbook([{ name: "S", xml: '<row r="1"><c r="A1"><v>7</v></c></row>' }]);
    parts.rels = "";
    expect(xlsxToText(parts).content).toBe("--- Sheet: sheet1 ---\n7");
  });
});

describe("helpers", () => {
  it.each([
    ["A1", 0],
    ["Z9", 25],
    ["AA1", 26],
    ["AZ3", 51],
  ])("columnIndex(%s) is %i", (ref, index) => {
    expect(columnIndex(ref)).toBe(index);
  });

  it("decodes named and numeric entities", () => {
    expect(decodeXmlText("&quot;a&apos; &#233; &#x263A; &bogus;")).toBe("\"a' é ☺ &bogus;");
  });

  it("parses an empty shared string", () => {
    expect(parseSharedStrings("<sst><si/><si><t>x</t></si></sst>")).toEqual(["", "x"]);
  });
});
